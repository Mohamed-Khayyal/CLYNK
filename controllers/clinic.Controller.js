const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { createNotification } = require("../utilts/notification");
const {
  attachGeoLocation,
  attachGeoLocationToMany,
  normalizeGeoLocation,
} = require("../utilts/geo.Location");

exports.createClinic = catchAsync(async (req, res, next) => {
  const { name, address, location, phone, email, geo_location } = req.body;

  const ownerUserId = req.user.user_id;

  if (!name || !location || !email) {
    return next(
      new AppError("Clinic name, location, and email are required", 400),
    );
  }

  const exists = await sql.query`
    SELECT clinic_id FROM dbo.Clinics
    WHERE owner_user_id = ${ownerUserId};
  `;

  if (exists.recordset.length) {
    return next(new AppError("You have already created a clinic", 409));
  }

  const clinicGeoLocation = normalizeGeoLocation(geo_location);

  const result = clinicGeoLocation
    ? await sql.query`
        INSERT INTO dbo.Clinics
          (owner_user_id, name, address, location, phone, email, status, geo_location)
        OUTPUT INSERTED.clinic_id, INSERTED.status
        VALUES
          (${ownerUserId},
           ${name},
           ${address || null},
           ${location},
           ${phone || null},
           ${email},
           'pending',
           geography::Point(${clinicGeoLocation.latitude}, ${clinicGeoLocation.longitude}, 4326));
      `
    : await sql.query`
        INSERT INTO dbo.Clinics
          (owner_user_id, name, address, location, phone, email, status, geo_location)
        OUTPUT INSERTED.clinic_id, INSERTED.status
        VALUES
          (${ownerUserId},
           ${name},
           ${address || null},
           ${location},
           ${phone || null},
           ${email},
           'pending',
           CAST(NULL AS GEOGRAPHY));
      `;

  const clinic = {
    ...result.recordset[0],
    geo_location: clinicGeoLocation || null,
  };

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
      ISNULL(ds.doctors_count, 0) AS doctors_count,
      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating

    FROM dbo.Clinics c

    OUTER APPLY (
      SELECT COUNT(*) AS doctors_count
      FROM dbo.Staff s
      JOIN dbo.Users su
        ON su.user_id = s.user_id
      WHERE s.clinic_id = c.clinic_id
        AND s.role_title = 'doctor'
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

    ORDER BY c.created_at DESC;
  `;

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
      s.role_title,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      u.photo,

      CASE
        WHEN s.role_title = 'doctor' THEN 1
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
        ISNULL(rs.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
      FROM dbo.Clinics c
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.clinic_id = c.clinic_id
      ) rs
      WHERE c.clinic_id = ${clinicId}
        AND status = 'approved';
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
      CONVERT(VARCHAR(5), s.work_from,108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to,108)   AS work_to,
      s.consultation_price,
      u.photo
    FROM dbo.Staff s
    JOIN dbo.Users u ON u.user_id = s.user_id
    WHERE s.clinic_id = ${clinicId}
      AND s.role_title = 'doctor'
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
      AND role_title = 'doctor'
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
