const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const {
  attachGeoLocation,
  attachGeoLocationToMany,
} = require("../utilts/geo.Location");

exports.getDoctors = catchAsync(async (req, res) => {
  const { specialist } = req.query;

  const request = new sql.Request();

  let specialistFilter = "";
  if (specialist) {
    specialistFilter = "AND d.specialist = @specialist";
    request.input("specialist", sql.NVarChar, specialist);
  }

  const result = await request.query(`
    SELECT
      d.doctor_id,
      d.full_name,
      d.gender,
      d.years_of_experience,
      d.bio,
      d.consultation_price,
      CONVERT(VARCHAR(5), d.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), d.work_to, 108)   AS work_to,
      d.work_days,
      d.location,
      d.geo_location.Lat AS geo_location_latitude,
      d.geo_location.Long AS geo_location_longitude,
      d.specialist,
      u.photo,
      ISNULL(bs.total_bookings, 0)      AS total_bookings,
      ISNULL(bs.total_patients, 0)      AS total_patients,
      ISNULL(rs.total_ratings, 0)       AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating,

      CAST(1 AS BIT) AS can_be_booked

    FROM dbo.Doctors d

    JOIN dbo.Users u
      ON u.user_id = d.user_id

    LEFT JOIN dbo.Clinics c
      ON c.owner_user_id = d.user_id
     AND c.status = 'approved'

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT b.patient_user_id) AS total_patients
      FROM dbo.Bookings b
      WHERE b.doctor_id = d.doctor_id
        AND b.status = 'confirmed'
    ) bs

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = d.doctor_id
    ) rs

    WHERE
      d.is_verified = 1
      AND c.clinic_id IS NULL
      ${specialistFilter}

    ORDER BY
      d.years_of_experience DESC,
      d.full_name;
  `);

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: attachGeoLocationToMany(result.recordset),
  });
});

exports.getDoctorProfile = catchAsync(async (req, res, next) => {
  const doctor_id = Number(req.params.id);

  if (!doctor_id) {
    return next(new AppError("Invalid doctor id", 400));
  }

  const doctor = await sql.query`
    SELECT
      d.doctor_id,
      d.user_id,
      u.email,
      d.full_name,
      d.phone,
      d.gender,
      d.specialist,
      d.work_days,
      CONVERT(VARCHAR(5), d.work_from,108) AS work_from,
      CONVERT(VARCHAR(5), d.work_to,108)   AS work_to,
      d.location,
      d.geo_location.Lat AS geo_location_latitude,
      d.geo_location.Long AS geo_location_longitude,
      d.consultation_price,
      d.years_of_experience,
      d.bio,
      d.is_verified,
      u.photo,
      ISNULL(bs.total_bookings, 0)            AS total_bookings,
      ISNULL(bs.total_patients, 0)            AS total_patients,
      ISNULL(rs.total_ratings, 0)             AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating

    FROM dbo.Doctors d

    JOIN dbo.Users u
      ON u.user_id = d.user_id

    LEFT JOIN dbo.Clinics c
      ON c.owner_user_id = d.user_id
     AND c.status = 'approved'

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT b.patient_user_id) AS total_patients
      FROM dbo.Bookings b
      WHERE b.doctor_id = d.doctor_id
        AND b.status = 'confirmed'
    ) bs

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = d.doctor_id
    ) rs

    WHERE
      d.doctor_id = ${doctor_id}
      AND d.is_verified = 1
      AND c.clinic_id IS NULL
  `;

  if (!doctor.recordset.length) {
    return next(new AppError("Doctor not found or unavailable for booking", 404));
  }

  res.status(200).json({
    status: "success",
    doctor: attachGeoLocation(doctor.recordset[0]),
  });
});

exports.getDoctorDashboard = catchAsync(async (req, res, next) => {
  const user_id = req.user.user_id;

  const doctor = (
    await sql.query`
      SELECT doctor_id
      FROM dbo.Doctors
      WHERE user_id = ${user_id}
        AND is_verified = 1;
    `
  ).recordset[0];

  if (!doctor) {
    return next(new AppError("Doctor profile not found", 404));
  }

  const doctor_id = doctor.doctor_id;

  const stats = (
    await sql.query`
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT patient_user_id) AS total_patients,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_bookings,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_bookings,
        SUM(
          CASE
            WHEN booking_date = CAST(GETDATE() AS DATE)
             AND status = 'confirmed'
            THEN 1 ELSE 0
          END
        ) AS today_bookings
      FROM dbo.Bookings
      WHERE doctor_id = ${doctor_id};
    `
  ).recordset[0];

  const upcomingBookings = await sql.query`
    SELECT TOP 5
      b.booking_id,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from,108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to,108)   AS booking_to,
      p.full_name AS patient_name,
      p.phone     AS patient_phone
    FROM dbo.Bookings b
    JOIN dbo.Patients p
      ON p.user_id = b.patient_user_id
    WHERE b.doctor_id = ${doctor_id}
      AND b.status = 'confirmed'
      AND b.booking_date >= CAST(GETDATE() AS DATE)
    ORDER BY b.booking_date, b.booking_from;
  `;

  const ratings = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,
        CAST(
          ISNULL(ROUND(AVG(CAST(rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)
        ) AS average_rating
      FROM dbo.Ratings
      WHERE doctor_id = ${doctor_id};
    `
  ).recordset[0];

  res.status(200).json({
    status: "success",
    dashboard: {
      stats,
      ratings,
      upcoming_bookings: upcomingBookings.recordset,
    },
  });
});

exports.getBestDoctorsAndStaff = catchAsync(async (req, res) => {
  const { specialist } = req.query;

  const requestedLimit = Number(req.query.limit);
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 20;

  const request = new sql.Request();

  let doctorSpecialistFilter = "";
  let staffSpecialistFilter = "";

  if (specialist) {
    doctorSpecialistFilter = "AND d.specialist = @specialist";
    staffSpecialistFilter = "AND s.specialist = @specialist";
    request.input("specialist", sql.NVarChar, specialist);
  }

  const result = await request.query(`
    SELECT TOP (${limit})
      providers.provider_type,
      providers.target_id,
      providers.doctor_id,
      providers.staff_id,
      providers.full_name,
      providers.specialist,
      providers.work_days,
      providers.work_from,
      providers.work_to,
      providers.consultation_price,
      providers.location,
      providers.photo,
      providers.clinic_id,
      providers.clinic_name,
      providers.total_bookings,
      providers.total_patients,
      providers.total_ratings,
      providers.average_rating,
      providers.can_be_booked
    FROM (
      SELECT
        'doctor' AS provider_type,
        d.doctor_id AS target_id,
        d.doctor_id,
        CAST(NULL AS INT) AS staff_id,
        d.full_name,
        d.specialist,
        d.work_days,
        CONVERT(VARCHAR(5), d.work_from, 108) AS work_from,
        CONVERT(VARCHAR(5), d.work_to, 108)   AS work_to,
        d.consultation_price,
        d.location,
        d.geo_location.Lat AS geo_location_latitude,
        d.geo_location.Long AS geo_location_longitude,
        u.photo,
        CAST(NULL AS INT) AS clinic_id,
        CAST(NULL AS NVARCHAR(150)) AS clinic_name,
        ISNULL(bs.total_bookings, 0) AS total_bookings,
        ISNULL(bs.total_patients, 0) AS total_patients,
        ISNULL(rs.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating,
        CAST(1 AS BIT) AS can_be_booked
      FROM dbo.Doctors d
      JOIN dbo.Users u
        ON u.user_id = d.user_id
      LEFT JOIN dbo.Clinics c
        ON c.owner_user_id = d.user_id
       AND c.status = 'approved'
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_bookings,
          COUNT(DISTINCT b.patient_user_id) AS total_patients
        FROM dbo.Bookings b
        WHERE b.doctor_id = d.doctor_id
          AND b.status = 'confirmed'
      ) bs
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.doctor_id = d.doctor_id
      ) rs
      WHERE d.is_verified = 1
        AND u.is_active = 1
        AND c.clinic_id IS NULL
        ${doctorSpecialistFilter}

      UNION ALL

      SELECT
        'staff' AS provider_type,
        s.staff_id AS target_id,
        CAST(NULL AS INT) AS doctor_id,
        s.staff_id,
        s.full_name,
        s.specialist,
        s.work_days,
        CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
        CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
        s.consultation_price,
        c.location,
        c.geo_location.Lat AS geo_location_latitude,
        c.geo_location.Long AS geo_location_longitude,
        su.photo,
        c.clinic_id,
        c.name AS clinic_name,
        ISNULL(bs.total_bookings, 0) AS total_bookings,
        ISNULL(bs.total_patients, 0) AS total_patients,
        ISNULL(cr.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(cr.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating,
        CAST(1 AS BIT) AS can_be_booked
      FROM dbo.Staff s
      JOIN dbo.Users su
        ON su.user_id = s.user_id
      JOIN dbo.Clinics c
        ON c.clinic_id = s.clinic_id
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_bookings,
          COUNT(DISTINCT b.patient_user_id) AS total_patients
        FROM dbo.Bookings b
        WHERE b.staff_id = s.staff_id
          AND b.status = 'confirmed'
      ) bs
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.clinic_id = c.clinic_id
      ) cr
      WHERE s.role_title = 'doctor'
        AND s.is_verified = 1
        AND su.is_active = 1
        AND c.status = 'approved'
        ${staffSpecialistFilter}
    ) providers
    ORDER BY
      providers.total_bookings DESC,
      providers.average_rating DESC,
      providers.full_name ASC;
  `);

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: attachGeoLocationToMany(result.recordset),
  });
});
