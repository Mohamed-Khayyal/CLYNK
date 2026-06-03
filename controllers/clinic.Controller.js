const bcrypt = require("bcryptjs");
const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { createNotification } = require("../utilts/notification");
const {
  attachGeoLocation,
  attachGeoLocationToMany,
  normalizeGeoLocation,
} = require("../utilts/geo.Location");

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

const parseLimit = (value, fallback = 5, max = 20) => {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) return fallback;
  return Math.min(limit, max);
};

exports.createClinic = catchAsync(async (req, res, next) => {
  const {
    name,
    address,
    location,
    phone,
    email,
    password,
    photo,
    geo_location,
  } = req.body;
  if (!name || !email || !password) {
    return next(
      new AppError("Name, email, and password are required", 400),
    );
  }

  if (typeof password !== "string" || password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  const existingUser = await sql.query`
    SELECT user_id FROM dbo.Users WHERE email = ${email};
  `;

  if (existingUser.recordset.length) {
    return next(new AppError("Email is already in use", 409));
  }

  const existingClinic = await sql.query`
    SELECT clinic_id FROM dbo.Clinics
    WHERE name = ${name} OR email = ${email};
  `;

  if (existingClinic.recordset.length) {
    return next(new AppError("Clinic name or email is already in use", 409));
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const clinicGeoLocation = normalizeGeoLocation(geo_location);
  const transaction = new sql.Transaction(sql.globalConnectionPool);
  let transactionStarted = false;
  let clinic;

  try {
    await transaction.begin();
    transactionStarted = true;

    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type, photo)
      OUTPUT INSERTED.user_id, INSERTED.email, INSERTED.photo
      VALUES (${email}, ${hashedPassword}, 'clinic', ${photo || null});
    `;

    const owner = userResult.recordset[0];

    const result = clinicGeoLocation
      ? await transaction.request().query`
          INSERT INTO dbo.Clinics
            (owner_user_id, name, address, location, phone, email, status, geo_location)
          OUTPUT INSERTED.clinic_id, INSERTED.status
          VALUES
            (${owner.user_id},
             ${name},
             ${address || null},
             ${location || null},
             ${phone || null},
             ${email},
             'pending',
             geography::Point(${clinicGeoLocation.latitude}, ${clinicGeoLocation.longitude}, 4326));
        `
      : await transaction.request().query`
          INSERT INTO dbo.Clinics
            (owner_user_id, name, address, location, phone, email, status, geo_location)
          OUTPUT INSERTED.clinic_id, INSERTED.status
          VALUES
            (${owner.user_id},
             ${name},
             ${address || null},
             ${location || null},
             ${phone || null},
             ${email},
             'pending',
             CAST(NULL AS GEOGRAPHY));
        `;

    clinic = {
      ...result.recordset[0],
      owner_user_id: owner.user_id,
      email: owner.email,
      photo: owner.photo,
      geo_location: clinicGeoLocation || null,
    };

    await transaction.commit();
  } catch (err) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error(
          "Failed to roll back clinic creation transaction:",
          rollbackErr.message,
        );
      }
    }
    return next(err);
  }

  const adminsResult = await sql.query`
    SELECT user_id FROM dbo.Admins;
  `;

  for (const admin of adminsResult.recordset) {
    await createNotification({
      user_id: admin.user_id,
      title: "طلب اعتماد عيادة",
      message: `تم إرسال طلب عيادة باسم "${name}" وهو بانتظار المراجعة.`,
    });
  }

  res.status(201).json({
    status: "success",
    clinic,
    message: "تم إنشاء العيادة وبانتظار اعتماد المشرف",
  });
});

exports.getPublicClinics = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      c.clinic_id,
      c.name,
      c.location,
      c.geo_location.Lat AS geo_location_latitude,
      c.geo_location.Long AS geo_location_longitude,
      c.phone,
      u.photo,
      ISNULL(ds.doctors_count, 0) AS doctors_count,
      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating

    FROM dbo.Clinics c
    JOIN dbo.Users u
      ON u.user_id = c.owner_user_id

    OUTER APPLY (
      SELECT COUNT(*) AS doctors_count
      FROM dbo.Staff s
      JOIN dbo.Users su
        ON su.user_id = s.user_id
      WHERE s.clinic_id = c.clinic_id
        AND s.work_days IS NOT NULL
        AND s.work_from IS NOT NULL
        AND s.work_to IS NOT NULL
        AND s.is_verified = 1
        AND su.is_active = 1
    ) ds

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.clinic_id = c.clinic_id
    ) rs

    WHERE c.status = 'approved'
      AND u.is_active = 1
          
    ORDER BY c.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    clinics: attachGeoLocationToMany(result.recordset),
  });
});

exports.getBestClinics = catchAsync(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const request = new sql.Request();
  request.input("limit", sql.Int, limit);

  const result = await request.query(`
    SELECT TOP (@limit)
      c.clinic_id,
      c.name,
      c.location,
      c.geo_location.Lat AS geo_location_latitude,
      c.geo_location.Long AS geo_location_longitude,
      c.phone,
      u.photo,
      ISNULL(bs.total_bookings, 0) AS total_bookings,
      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating

    FROM dbo.Clinics c
    JOIN dbo.Users u
      ON u.user_id = c.owner_user_id

    OUTER APPLY (
      SELECT COUNT(*) AS total_bookings
      FROM dbo.Bookings b
      JOIN dbo.Staff s
        ON s.staff_id = b.staff_id
      WHERE s.clinic_id = c.clinic_id
        AND b.status = 'confirmed'
    ) bs

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.clinic_id = c.clinic_id
    ) rs

    WHERE c.status = 'approved'
      AND u.is_active = 1

    ORDER BY
      average_rating DESC,
      total_bookings DESC,
      total_ratings DESC,
      c.created_at DESC;
  `);

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    clinics: attachGeoLocationToMany(result.recordset),
  });
});

exports.getActiveClinicStaff = catchAsync(async (req, res, next) => {
  const clinicId = Number(req.params.clinicId);

  if (!clinicId) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const result = await sql.query`
    SELECT
      s.staff_id,
      s.full_name,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      u.photo,

      CASE
        WHEN s.work_days IS NOT NULL
          AND s.work_from IS NOT NULL
          AND s.work_to IS NOT NULL THEN 1
        ELSE 0
      END AS can_be_booked

    FROM dbo.Staff s
    JOIN dbo.Users u
      ON s.user_id = u.user_id

    WHERE s.clinic_id = ${clinicId}
      AND s.is_verified = 1
      AND u.is_active = 1

    ORDER BY s.full_name ASC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    staff: result.recordset,
  });
});

exports.getClinicProfile = catchAsync(async (req, res, next) => {
  const clinicId = Number(req.params.id);

  if (!clinicId) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const clinic = (
    await sql.query`
      SELECT
        c.clinic_id,
        c.name,
        c.location,
        c.geo_location.Lat AS geo_location_latitude,
        c.geo_location.Long AS geo_location_longitude,
        c.phone,
        u.photo,
        ISNULL(rs.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
      FROM dbo.Clinics c
      JOIN dbo.Users u
        ON u.user_id = c.owner_user_id
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.clinic_id = c.clinic_id
      ) rs
      WHERE c.clinic_id = ${clinicId}
        AND c.status = 'approved'
        AND u.is_active = 1;
    `
  ).recordset[0];

  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  const staff = await sql.query`
    SELECT
      s.staff_id,
      s.full_name,
      s.specialist,
      s.work_days,
      s.years_of_experience,
      CONVERT(VARCHAR(5), s.work_from,108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to,108)   AS work_to,
      s.consultation_price,
      u.photo,
      ISNULL(rt.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rt.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
    FROM dbo.Staff s
    JOIN dbo.Users u ON u.user_id = s.user_id
    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.staff_id = s.staff_id
    ) rt
    WHERE s.clinic_id = ${clinicId}
      AND s.work_days IS NOT NULL
      AND s.work_from IS NOT NULL
      AND s.work_to IS NOT NULL
      AND s.is_verified = 1;
  `;

  res.status(200).json({
    status: "success",
    clinic: attachGeoLocation(clinic),
    doctors: staff.recordset,
  });
});

exports.getClinicStats = catchAsync(async (req, res) => {
  const clinic_id = req.clinic.clinic_id;

  const stats = await sql.query`
    SELECT
      COUNT(b.booking_id) AS total_bookings,
      COUNT(DISTINCT b.patient_user_id) AS total_patients,

      SUM(
        CASE
          WHEN b.booking_date = CAST(GETDATE() AS DATE)
          THEN 1 ELSE 0
        END
      ) AS today_bookings

    FROM dbo.Bookings b
    JOIN dbo.Staff s
      ON s.staff_id = b.staff_id
    WHERE s.clinic_id = ${clinic_id}
      AND b.status = 'confirmed';
  `;

  const doctorsCount = await sql.query`
    SELECT COUNT(*) AS total_doctors
    FROM dbo.Staff
    WHERE clinic_id = ${clinic_id}
      AND work_days IS NOT NULL
      AND work_from IS NOT NULL
      AND work_to IS NOT NULL
      AND is_verified = 1;
  `;

  const ratings = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,
        CAST(
          ISNULL(ROUND(AVG(CAST(rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)
        ) AS average_rating
      FROM dbo.Ratings
      WHERE clinic_id = ${clinic_id};
    `
  ).recordset[0];

  res.status(200).json({
    status: "success",
    stats: {
      total_bookings: stats.recordset[0].total_bookings,
      today_bookings: stats.recordset[0].today_bookings,
      total_patients: stats.recordset[0].total_patients,
      total_doctors: doctorsCount.recordset[0].total_doctors,
      total_ratings: ratings.total_ratings,
      average_rating: ratings.average_rating,
    },
  });
});
