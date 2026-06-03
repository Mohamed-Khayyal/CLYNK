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
      ${specialistFilter}
      AND u.is_active = 1

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
      AND u.is_active = 1
  `;

  if (!doctor.recordset.length) {
    return next(
      new AppError("Doctor not found or unavailable for booking", 404),
    );
  }

  res.status(200).json({
    status: "success",
    doctor: attachGeoLocation(doctor.recordset[0]),
  });
});

exports.getDoctorDashboard = catchAsync(async (req, res, next) => {
  const user_id = req.user.user_id;

  let doctor_id;
  let profileType = "doctor";

  // search in Doctors table
  const doctor = (
    await sql.query`
      SELECT doctor_id
      FROM dbo.Doctors
      WHERE user_id = ${user_id}
      AND is_verified = 1;
    `
  ).recordset[0];

  if (doctor) {
    doctor_id = doctor.doctor_id;
  } else {
    // search in Staff table
    const staff = (
      await sql.query`
        SELECT staff_id
        FROM dbo.Staff
        WHERE user_id = ${user_id}
          AND work_days IS NOT NULL
          AND work_from IS NOT NULL
          AND work_to IS NOT NULL
          AND is_verified = 1;
      `
    ).recordset[0];

    if (!staff) return next(new AppError("Doctor profile not found", 404));

    doctor_id = staff.staff_id;
    profileType = "staff";
  }

  const stats = (
    await sql.query`
      SELECT
        COUNT(*) AS total_bookings,

        COUNT(DISTINCT patient_user_id)
        AS total_patients,

        SUM(
          CASE
            WHEN status='confirmed'
            THEN 1 ELSE 0
          END
        ) AS confirmed_bookings,

        SUM(
          CASE
            WHEN status='cancelled'
            THEN 1 ELSE 0
          END
        ) AS cancelled_bookings,

        SUM(
          CASE
            WHEN booking_date =
              CAST(GETDATE() AS DATE)
             AND status='confirmed'
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

      CONVERT(
        VARCHAR(5),
        b.booking_from,
        108
      ) AS booking_from,

      CONVERT(
        VARCHAR(5),
        b.booking_to,
        108
      ) AS booking_to,

      p.full_name AS patient_name,
      p.phone AS patient_phone,
      b.status

    FROM dbo.Bookings b

    JOIN dbo.Patients p
      ON p.user_id =
         b.patient_user_id

    WHERE b.doctor_id =
      ${doctor_id}

      AND b.status='confirmed'

      AND b.booking_date >=
      CAST(GETDATE() AS DATE)

    ORDER BY
      b.booking_date,
      b.booking_from;
  `;

  const ratings = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,

        CAST(
          ISNULL(
            ROUND(
              AVG(
                CAST(rating AS FLOAT)
              ),
              1
            ),
            0
          )

        AS DECIMAL(3,1))

        AS average_rating

      FROM dbo.Ratings

      WHERE doctor_id =
      ${doctor_id};
    `
  ).recordset[0];

  res.status(200).json({
    status: "success",

    dashboard: {
      profile_type: profileType,

      stats: {
        total_bookings: stats.total_bookings || 0,

        total_patients: stats.total_patients || 0,

        confirmed_bookings: stats.confirmed_bookings || 0,

        cancelled_bookings: stats.cancelled_bookings || 0,

        today_bookings: stats.today_bookings || 0,
      },

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

  let doctorFilter = "";
  let staffFilter = "";

  if (specialist) {
    doctorFilter = "AND d.specialist = @specialist";
    staffFilter = "AND s.specialist = @specialist";

    request.input("specialist", sql.NVarChar, specialist);
  }

  const result = await request.query(`
    SELECT TOP (${limit})
      provider_type,
      target_id,
      doctor_id,
      staff_id,
      full_name,
      specialist,
      work_days,
      work_from,
      work_to,
      consultation_price,
      location,
      photo,
      clinic_id,
      clinic_name,
      total_bookings,
      total_patients,
      total_ratings,
      average_rating,
      can_be_booked,
      geo_location_latitude,
      geo_location_longitude
    FROM (

      ------------------ Doctors ------------------
      SELECT
        'doctor' AS provider_type,
        d.doctor_id AS target_id,
        d.doctor_id,
        NULL AS staff_id,
        d.full_name,
        d.specialist,
        d.work_days,
        CONVERT(VARCHAR(5), d.work_from,108) AS work_from,
        CONVERT(VARCHAR(5), d.work_to,108) AS work_to,
        d.consultation_price,
        d.location,
        u.photo,

        NULL AS clinic_id,
        NULL AS clinic_name,

        d.geo_location.Lat AS geo_location_latitude,
        d.geo_location.Long AS geo_location_longitude,

        ISNULL(bs.total_bookings,0) total_bookings,
        ISNULL(bs.total_patients,0) total_patients,

        ISNULL(rs.total_ratings,0) total_ratings,
        CAST(ISNULL(rs.average_rating,0) AS DECIMAL(3,1))
          average_rating,

        CAST(1 AS BIT) can_be_booked

      FROM Doctors d
      JOIN Users u
      ON u.user_id=d.user_id

      OUTER APPLY(
          SELECT
            COUNT(*) total_bookings,
            COUNT(DISTINCT patient_user_id) total_patients
          FROM Bookings
          WHERE doctor_id=d.doctor_id
          AND status='confirmed'
      ) bs

      OUTER APPLY(
          SELECT
            COUNT(*) total_ratings,
            ROUND(AVG(CAST(rating AS FLOAT)),1)
            average_rating
          FROM Ratings
          WHERE doctor_id=d.doctor_id
      ) rs

      WHERE
        d.is_verified=1
        AND u.is_active=1
        ${doctorFilter}

      UNION ALL

      SELECT
        'staff',
        s.staff_id,
        NULL,
        s.staff_id,
        s.full_name,
        s.specialist,
        s.work_days,

        CONVERT(VARCHAR(5),s.work_from,108),
        CONVERT(VARCHAR(5),s.work_to,108),

        s.consultation_price,
        c.location,
        su.photo,

        c.clinic_id,
        c.name,

        c.geo_location.Lat,
        c.geo_location.Long,

        ISNULL(bs.total_bookings,0),
        ISNULL(bs.total_patients,0),

        ISNULL(rt.total_ratings,0),

        CAST(
          ISNULL(rt.average_rating,0)
          AS DECIMAL(3,1)
        ),

        CAST(1 AS BIT)

      FROM Staff s

      JOIN Users su
      ON su.user_id=s.user_id

      JOIN Clinics c
      ON c.clinic_id=s.clinic_id

      OUTER APPLY(
          SELECT
            COUNT(*) total_bookings,
            COUNT(DISTINCT patient_user_id)
            total_patients
          FROM Bookings
          WHERE staff_id=s.staff_id
          AND status='confirmed'
      ) bs

      OUTER APPLY(
          SELECT
            COUNT(*) total_ratings,
            ROUND(AVG(CAST(rating AS FLOAT)),1)
            average_rating
          FROM Ratings
          WHERE staff_id=s.staff_id
      ) rt

      WHERE
        s.work_days IS NOT NULL
        AND s.work_from IS NOT NULL
        AND s.work_to IS NOT NULL
        AND s.is_verified=1
        AND su.is_active=1
        AND c.status='approved'
        ${staffFilter}

    ) providers

    ORDER BY
      average_rating DESC,
      total_bookings DESC,
      total_patients DESC,
      full_name ASC
  `);

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: attachGeoLocationToMany(result.recordset),
  });
});
