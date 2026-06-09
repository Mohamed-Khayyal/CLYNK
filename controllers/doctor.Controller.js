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

  let doctor_id = null;
  let staff_id = null;
  let profileType = "doctor";
  let specialistName = "General";

  // search in Doctors table
  const doctor = (
    await sql.query`
      SELECT doctor_id, specialist, full_name
      FROM dbo.Doctors
      WHERE user_id = ${user_id}
      AND is_verified = 1;
    `
  ).recordset[0];

  if (doctor) {
    doctor_id = doctor.doctor_id;
    specialistName = doctor.specialist || "General";
  } else {
    // search in Staff table
    const staff = (
      await sql.query`
        SELECT staff_id, specialist, full_name
        FROM dbo.Staff
        WHERE user_id = ${user_id}
          AND work_days IS NOT NULL
          AND work_from IS NOT NULL
          AND work_to IS NOT NULL
          AND is_verified = 1;
      `
    ).recordset[0];

    if (!staff) return next(new AppError("Doctor profile not found", 404));

    staff_id = staff.staff_id;
    profileType = "staff";
    specialistName = staff.specialist || "General";
  }

  const request = new sql.Request();
  request.input("providerId", sql.Int, doctor_id || staff_id);
  const filterCol = doctor_id ? "b.doctor_id" : "b.staff_id";

  const bookingsResult = await request.query(`
    SELECT
      b.booking_id,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to, 108)   AS booking_to,
      b.status,
      b.prescription_access_status,
      p.patient_id,
      p.full_name AS patient_name,
      p.phone     AS patient_phone,
      p.gender    AS patient_gender,
      COALESCE(d.full_name, s.full_name) AS doctor_name,
      COALESCE(d.specialist, s.specialist) AS specialty,
      pr.prescription_id,
      pr.diagnosis
    FROM dbo.Bookings b
    LEFT JOIN dbo.Patients p ON p.user_id = b.patient_user_id
    LEFT JOIN dbo.Doctors d ON d.doctor_id = b.doctor_id
    LEFT JOIN dbo.Staff s ON s.staff_id = b.staff_id
    LEFT JOIN dbo.Prescriptions pr ON pr.booking_id = b.booking_id
    WHERE ${filterCol} = @providerId
    ORDER BY b.booking_date DESC, b.booking_from DESC;
  `);
  const bookings = bookingsResult.recordset;

  const ratingsQuery = doctor_id
    ? sql.query`
        SELECT
          COUNT(*) AS total_ratings,
          CAST(ISNULL(ROUND(AVG(CAST(rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Ratings
        WHERE doctor_id = ${doctor_id};
      `
    : sql.query`
        SELECT
          COUNT(*) AS total_ratings,
          CAST(ISNULL(ROUND(AVG(CAST(rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Ratings
        WHERE staff_id = ${staff_id};
      `;
  const ratings = (await ratingsQuery).recordset[0];

  const getFormattedDate = (dateValue) => {
    if (!dateValue) return "";
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? String(dateValue) : d.toISOString().slice(0, 10);
  };

  const getBookingTime = (b) => b.booking_from || "";

  const buildLastSevenDays = () => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
  };

  const buildWeeklyPatients = (bookingsList) => {
    const last7Days = buildLastSevenDays();
    return last7Days.map((dateStr) => {
      const dayBookings = bookingsList.filter((b) => getFormattedDate(b.booking_date) === dateStr);
      const seen = new Set();
      
      for (const b of bookingsList) {
        const bDate = getFormattedDate(b.booking_date);
        if (!b.patient_id || bDate >= dateStr) continue;
        seen.add(b.patient_id);
      }

      let newPatients = 0;
      const returning = new Set();

      for (const b of dayBookings) {
        if (!b.patient_id) continue;
        if (seen.has(b.patient_id)) {
          returning.add(b.patient_id);
        } else {
          newPatients += 1;
          seen.add(b.patient_id);
        }
      }

      return {
        date: dateStr,
        exixiting: returning.size,
        new: newPatients,
      };
    });
  };

  const buildTrend = (total) => {
    const safeTotal = Math.max(total, 1);
    return Array.from({ length: 5 }, (_, index) => ({
      value: Math.max(0, Math.round((safeTotal * (index + 1)) / 5)),
    }));
  };

  const uniquePatientsSet = new Set();
  const patientsMap = new Map();
  bookings.forEach((b) => {
    const key = b.patient_phone || b.patient_name || (b.patient_id ? String(b.patient_id) : "") || String(b.booking_id);
    if (key) {
      uniquePatientsSet.add(key);
    }
    if (b.patient_id) {
      const existing = patientsMap.get(b.patient_id);
      const bDate = getFormattedDate(b.booking_date);
      const eDate = existing ? getFormattedDate(existing.booking_date) : "";
      const bTime = getBookingTime(b);
      const eTime = existing ? getBookingTime(existing) : "";
      if (!existing || `${bDate} ${bTime}` > `${eDate} ${eTime}`) {
        patientsMap.set(b.patient_id, b);
      }
    }
  });

  const totalBookings = bookings.length;
  const totalPatients = uniquePatientsSet.size;

  const pendingBookings = bookings.filter((b) => b.status === "pending" || b.prescription_access_status === "pending");
  const completedBookings = bookings.filter((b) => b.prescription_id !== null);
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled" || b.status === "rejected");
  const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings.length / totalBookings) * 100) : 0;

  const doctorObj = {
    full_name: doctor ? doctor.full_name : (staff ? staff.full_name : "General"),
    specialist: specialistName,
    rating: Number(ratings.average_rating) || 0,
    total_bookings: totalBookings,
    pending_bookings: pendingBookings.length,
    completed_bookings: completedBookings.length,
  };

  const appointmentRows = bookings.map((b) => ({
    id: String(b.patient_id ?? b.booking_id),
    name: b.patient_name || `Patient #${b.patient_id}`,
    type: "زيارة",
    doctor: b.doctor_name || doctorObj.full_name,
    status: b.status || "confirmed",
    date: [getFormattedDate(b.booking_date), getBookingTime(b)].filter(Boolean).join(", "),
  }));

  const appointmentRequests = bookings
    .filter((b) => b.prescription_access_status === "pending")
    .slice(0, 5)
    .map((b) => ({
      id: b.booking_id,
      name: b.patient_name || `Patient #${b.patient_id}`,
      specialty: b.specialty || specialistName || "General",
      time: [getFormattedDate(b.booking_date), getBookingTime(b)].filter(Boolean).join(", "),
      image: `https://i.pravatar.cc/40?u=${b.patient_id ?? b.booking_id}`,
      status: "pending",
    }));

  const patientsList = Array.from(patientsMap.values()).map((b) => ({
    id: b.patient_id,
    name: b.patient_name || `Patient #${b.patient_id}`,
    gender: b.patient_gender || "غير محدد",
    department: b.specialty || specialistName || "General",
    date: getFormattedDate(b.booking_date) || "",
  }));

  const reportsList = bookings
    .filter((b) => b.prescription_id !== null)
    .map((b) => ({
      id: b.prescription_id,
      name: b.patient_name || `Patient #${b.patient_id}`,
      status: "available",
      description: b.diagnosis || "روشتة طبية",
    }));

  const todayDateStr = new Date().toISOString().slice(0, 10);
  const todayAppointmentsList = bookings
    .filter((b) => getFormattedDate(b.booking_date) === todayDateStr)
    .sort((a, b) => getBookingTime(a).localeCompare(getBookingTime(b)))
    .map((b) => ({
      id: b.booking_id,
      name: b.patient_name || `Patient #${b.patient_id}`,
      type: b.status || "confirmed",
      date: getFormattedDate(b.booking_date),
      time: getBookingTime(b),
    }));

  const genderStats = (() => {
    const total = patientsList.length;
    if (!total) return { male: 0, female: 0, total: 0 };
    const male = patientsList.filter((p) =>
      ["male", "m", "ذكر"].includes((p.gender || "").toLowerCase())
    ).length;
    const female = patientsList.filter((p) =>
      ["female", "f", "أنثى", "انثى"].includes((p.gender || "").toLowerCase())
    ).length;
    return {
      male: Math.round((male / total) * 100),
      female: Math.round((female / total) * 100),
      total: 100,
    };
  })();

  const cards = {
    appointments: {
      value: totalBookings,
      percentage: 0,
      trend: buildTrend(totalBookings),
    },
    patients: {
      value: totalPatients,
      percentage: 0,
      trend: buildTrend(totalPatients),
    },
  };

  res.status(200).json({
    status: "success",
    dashboard: {
      profile_type: profileType,
      doctor: doctorObj,
      totals: {
        appointments: totalBookings,
        patients: totalPatients,
        pending: doctorObj.pending_bookings,
        completed: doctorObj.completed_bookings,
        rating: doctorObj.rating,
        cancellationRate,
      },
      cards,
      weeklyPatients: buildWeeklyPatients(bookings),
      genderStats,
      appointmentRequests,
      appointments: appointmentRows,
      patients: patientsList,
      reports: reportsList,
      todayAppointments: todayAppointmentsList,
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
