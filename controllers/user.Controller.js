const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const {
  attachGeoLocation,
  getGeoLocationFromBody,
  normalizeGeoLocation,
} = require("../utilts/geo.Location");

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const v = value.trim();
    return v === "" ? null : v;
  }
  return value;
};

const NAME_REGEX = /^[\p{L}\s.'-]{2,150}$/u;
const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

exports.getMe = catchAsync(async (req, res, next) => {
  const { user_id } = req.user;

  const userResult = await sql.query`
    SELECT email, user_type, is_active, photo
    FROM dbo.Users
    WHERE user_id = ${user_id};
  `;

  if (!userResult.recordset.length) {
    return next(new AppError("User not found", 404));
  }

  const { email, user_type, is_active, photo } = userResult.recordset[0];
  let profile = null;

  if (user_type === "patient") {
    profile = (
      await sql.query`
        SELECT
          patient_id,
          full_name,
          CONVERT(VARCHAR(10), date_of_birth, 120) AS date_of_birth,
          gender,
          phone
        FROM dbo.Patients
        WHERE user_id = ${user_id};
      `
    ).recordset[0];
  } else if (user_type === "doctor") {
    profile = (
      await sql.query`
        SELECT
        doctor_id,
          full_name,
          phone,
          gender,
          years_of_experience,
          bio,
          consultation_price,
          CONVERT(VARCHAR(5), work_from, 108) AS work_from,
          CONVERT(VARCHAR(5), work_to, 108)   AS work_to,
          specialist,
          work_days,
          location,
          geo_location.Lat AS geo_location_latitude,
          geo_location.Long AS geo_location_longitude,
          is_verified,
          ISNULL(rs.total_ratings, 0) AS total_ratings,
          CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Doctors d
        OUTER APPLY (
          SELECT
            COUNT(*) AS total_ratings,
            ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
          FROM dbo.Ratings r
          WHERE r.doctor_id = d.doctor_id
        ) rs
        WHERE d.user_id = ${user_id};
      `
    ).recordset[0];
    attachGeoLocation(profile);
  } else if (user_type === "staff") {
    profile = (
      await sql.query`
        SELECT
          staff_id,
          s.full_name,
          s.years_of_experience,
          s.bio,
          s.gender,
          s.specialist,
          s.work_days,
          CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
          CONVERT(VARCHAR(5), s.work_to, 108) AS work_to,
          s.consultation_price,
          s.phone,
          s.location,
          s.geo_location.Lat AS geo_location_latitude,
          s.geo_location.Long AS geo_location_longitude,
          s.is_verified,
          s.clinic_id,
          c.name AS clinic_name,
          c.location AS clinic_location,
          c.geo_location.Lat AS clinic_geo_location_latitude,
          c.geo_location.Long AS clinic_geo_location_longitude,
          ISNULL(rs.total_ratings, 0) AS total_ratings,
          CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Staff s
        JOIN dbo.Clinics c
          ON c.clinic_id = s.clinic_id
        OUTER APPLY (
          SELECT
            COUNT(*) AS total_ratings,
            ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
          FROM dbo.Ratings r
          WHERE r.staff_id = s.staff_id
        ) rs
        WHERE s.user_id = ${user_id};
      `
    ).recordset[0];
    attachGeoLocation(profile);
    attachGeoLocation(profile, { targetKey: "clinic_geo_location" });
  } else if (user_type === "clinic") {
    profile = (
      await sql.query`
        SELECT
          clinic_id,
          name,
          address,
          location,
          phone,
          email,
          status,
          geo_location.Lat AS geo_location_latitude,
          geo_location.Long AS geo_location_longitude
        FROM dbo.Clinics
        WHERE owner_user_id = ${user_id};
      `
    ).recordset[0];
    attachGeoLocation(profile);
  } else if (user_type === "admin") {
    profile = (
      await sql.query`
        SELECT admin_id, full_name
        FROM dbo.Admins
        WHERE user_id = ${user_id};
      `
    ).recordset[0];
  }

  res.status(200).json({
    status: "success",
    user: {
      user_id,
      email,
      role: user_type,
      is_active,
      photo,
      profile,
    },
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { user_id, user_type } = req.user;
  const data = { ...req.body };

  if (!data || Object.keys(data).length === 0) {
    return next(new AppError("No update data was provided", 400));
  }

  let photo;
  if (data.photo) {
    await sql.query`
      UPDATE dbo.Users
      SET photo = ${data.photo}
      WHERE user_id = ${user_id};
    `;
    photo = data.photo;
  } else {
    const current = await sql.query`
      SELECT photo FROM dbo.Users WHERE user_id = ${user_id};
    `;
    photo = current.recordset[0]?.photo || null;
  }

  let updateProfile;
  let selectProfile;

  if (user_type === "patient") {
    let { full_name, date_of_birth, gender, phone } = data;

    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) {
      return next(new AppError("Invalid full_name value", 400));
    }

    updateProfile = () => sql.query`
      UPDATE dbo.Patients
      SET
        full_name     = COALESCE(CAST(${full_name} AS NVARCHAR(150)), full_name),
        date_of_birth = COALESCE(${normalize(date_of_birth)}, date_of_birth),
        gender        = COALESCE(${normalize(gender)}, gender),
        phone         = COALESCE(${normalize(phone)}, phone)
      WHERE user_id = ${user_id};
    `;

    selectProfile = () => sql.query`
      SELECT
        full_name,
        CONVERT(VARCHAR(10), date_of_birth, 120) AS date_of_birth,
        gender,
        phone
      FROM dbo.Patients
      WHERE user_id = ${user_id};
    `;
  } else if (user_type === "doctor") {
    let {
      full_name,
      gender,
      years_of_experience,
      bio,
      consultation_price,
      phone,
      work_from,
      work_to,
      specialist,
      work_days,
      location,
    } = data;
    const doctorGeoLocation = normalizeGeoLocation(getGeoLocationFromBody(data));

    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) {
      return next(new AppError("Invalid full_name value", 400));
    }

    if (work_from && !TIME_REGEX.test(work_from))
      return next(new AppError("Invalid work_from format", 400));

    if (work_to && !TIME_REGEX.test(work_to))
      return next(new AppError("Invalid work_to format", 400));

    if (Array.isArray(work_days)) work_days = work_days.join(",");

    updateProfile = async () => {
      const result = await sql.query`
        UPDATE dbo.Doctors
        SET
          full_name           = COALESCE(CAST(${full_name} AS NVARCHAR(150)), full_name),
          gender              = COALESCE(${normalize(gender)}, gender),
          years_of_experience = COALESCE(${normalize(years_of_experience)}, years_of_experience),
          bio                 = COALESCE(${normalize(bio)}, bio),
          consultation_price  = COALESCE(${normalize(consultation_price)}, consultation_price),
          phone               = COALESCE(${normalize(phone)}, phone),
          work_from           = COALESCE(${normalize(work_from)}, work_from),
          work_to             = COALESCE(${normalize(work_to)}, work_to),
          specialist          = COALESCE(${normalize(specialist)}, specialist),
          work_days           = COALESCE(${normalize(work_days)}, work_days),
          location            = COALESCE(${normalize(location)}, location)
        WHERE user_id = ${user_id};
      `;

      if (doctorGeoLocation !== undefined && result.rowsAffected[0] > 0) {
        if (doctorGeoLocation) {
          await sql.query`
            UPDATE dbo.Doctors
            SET geo_location = geography::Point(${doctorGeoLocation.latitude}, ${doctorGeoLocation.longitude}, 4326)
            WHERE user_id = ${user_id};
          `;
        } else {
          await sql.query`
            UPDATE dbo.Doctors
            SET geo_location = NULL
            WHERE user_id = ${user_id};
          `;
        }
      }

      return result;
    };

    selectProfile = () => sql.query`
      SELECT
        full_name,
        gender,
        years_of_experience,
        bio,
        consultation_price,
        phone,
        CONVERT(VARCHAR(5), work_from, 108) AS work_from,
        CONVERT(VARCHAR(5), work_to, 108)   AS work_to,
        specialist,
        work_days,
        location,
        geo_location.Lat AS geo_location_latitude,
        geo_location.Long AS geo_location_longitude,
        is_verified,
        ISNULL(rs.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
      FROM dbo.Doctors d
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.doctor_id = d.doctor_id
      ) rs
      WHERE d.user_id = ${user_id};
    `;
  } else if (user_type === "staff") {
    const staff = (
      await sql.query`
        SELECT role_title
        FROM dbo.Staff
        WHERE user_id = ${user_id};
      `
    ).recordset[0];

    if (!staff)
      return next(new AppError("Profile not found", 404));

    const isStaffDoctor = staff.role_title === "doctor";

    let {
      full_name,
      gender,
      years_of_experience,
      bio,
      specialist,
      work_days,
      work_from,
      work_to,
      consultation_price,
      phone,
      location,
    } = data;

    const staffGeoLocation =
      normalizeGeoLocation(getGeoLocationFromBody(data));

    full_name = normalize(full_name);

    if (full_name && !NAME_REGEX.test(full_name)) {
      return next(new AppError("Invalid full_name value", 400));
    }

    if (work_from && !TIME_REGEX.test(work_from))
      return next(new AppError("Invalid work_from format", 400));

    if (work_to && !TIME_REGEX.test(work_to))
      return next(new AppError("Invalid work_to format", 400));

    if (Array.isArray(work_days))
      work_days = work_days.join(",");

    updateProfile = async () => {
      const result = await sql.query`
        UPDATE dbo.Staff
        SET
          full_name           = COALESCE(CAST(${full_name} AS NVARCHAR(150)), full_name),
          gender              = COALESCE(${normalize(gender)}, gender),
          years_of_experience = COALESCE(${normalize(years_of_experience)}, years_of_experience),
          bio                 = COALESCE(${normalize(bio)}, bio),
          phone               = COALESCE(${normalize(phone)}, phone),
  
          specialist          = COALESCE(
            ${isStaffDoctor ? normalize(specialist) : null},
            specialist
          ),
  
          work_days           = COALESCE(
            ${isStaffDoctor ? normalize(work_days) : null},
            work_days
          ),
  
          work_from           = COALESCE(
            ${isStaffDoctor ? normalize(work_from) : null},
            work_from
          ),
  
          work_to             = COALESCE(
            ${isStaffDoctor ? normalize(work_to) : null},
            work_to
          ),
  
          consultation_price  = COALESCE(
            ${isStaffDoctor ? normalize(consultation_price) : null},
            consultation_price
          ),
  
          location            = COALESCE(
            ${normalize(location)},
            location
          )
  
        WHERE user_id = ${user_id};
      `;

      if (staffGeoLocation !== undefined && result.rowsAffected[0] > 0) {
        if (staffGeoLocation) {
          await sql.query`
            UPDATE dbo.Staff
            SET geo_location =
              geography::Point(
                ${staffGeoLocation.latitude},
                ${staffGeoLocation.longitude},
                4326
              )
            WHERE user_id = ${user_id};
          `;
        } else {
          await sql.query`
            UPDATE dbo.Staff
            SET geo_location = NULL
            WHERE user_id = ${user_id};
          `;
        }
      }

      return result;
    };

    selectProfile = () => sql.query`
      SELECT
        full_name,
        gender,
        years_of_experience,
        bio,
        phone,
        role_title,
        specialist,
        work_days,
        consultation_price,
        location,
  
        CONVERT(VARCHAR(5), work_from,108) AS work_from,
        CONVERT(VARCHAR(5), work_to,108) AS work_to,
  
        geo_location.Lat  AS geo_location_latitude,
        geo_location.Long AS geo_location_longitude,
  
        clinic_id,
        is_verified
  
      FROM dbo.Staff
      WHERE user_id = ${user_id};
    `;
  } else if (user_type === "clinic") {
    let { name, address, location, phone, email } = data;
    const clinicGeoLocation = normalizeGeoLocation(getGeoLocationFromBody(data));

    name = normalize(name);
    if (name && (typeof name !== "string" || name.length > 150)) {
      return next(new AppError("Invalid clinic name value", 400));
    }

    email = normalize(email);
    if (email && !EMAIL_REGEX.test(email)) {
      return next(new AppError("Invalid email format", 400));
    }

    if (email) {
      const duplicate = await sql.query`
        SELECT 1 AS duplicate_found
        FROM dbo.Users
        WHERE email = ${email}
          AND user_id <> ${user_id}
        UNION
        SELECT 1 AS duplicate_found
        FROM dbo.Clinics
        WHERE email = ${email}
          AND owner_user_id <> ${user_id};
      `;

      if (duplicate.recordset.length) {
        return next(new AppError("Email is already in use", 409));
      }
    }

    updateProfile = async () => {
      if (email) {
        await sql.query`
          UPDATE dbo.Users
          SET email = ${email}
          WHERE user_id = ${user_id};
        `;
      }

      const result = await sql.query`
        UPDATE dbo.Clinics
        SET
          name = COALESCE(CAST(${name} AS NVARCHAR(150)), name),
          address = COALESCE(CAST(${normalize(address)} AS NVARCHAR(255)), address),
          location = COALESCE(CAST(${normalize(location)} AS NVARCHAR(150)), location),
          phone = COALESCE(${normalize(phone)}, phone),
          email = COALESCE(${email}, email)
        WHERE owner_user_id = ${user_id};
      `;

      if (clinicGeoLocation !== undefined && result.rowsAffected[0] > 0) {
        if (clinicGeoLocation) {
          await sql.query`
            UPDATE dbo.Clinics
            SET geo_location = geography::Point(${clinicGeoLocation.latitude}, ${clinicGeoLocation.longitude}, 4326)
            WHERE owner_user_id = ${user_id};
          `;
        } else {
          await sql.query`
            UPDATE dbo.Clinics
            SET geo_location = NULL
            WHERE owner_user_id = ${user_id};
          `;
        }
      }

      return result;
    };

    selectProfile = () => sql.query`
      SELECT
        clinic_id,
        name,
        address,
        location,
        phone,
        email,
        status,
        geo_location.Lat AS geo_location_latitude,
        geo_location.Long AS geo_location_longitude
      FROM dbo.Clinics
      WHERE owner_user_id = ${user_id};
    `;
  } else if (user_type === "admin") {
    let { full_name } = data;
    full_name = normalize(full_name);

    if (full_name && !NAME_REGEX.test(full_name)) {
      return next(new AppError("Invalid full_name value", 400));
    }

    if (!full_name && !data.photo) {
      return next(
        new AppError("Admin can update only full_name or photo", 400),
      );
    }

    updateProfile = full_name
      ? () => sql.query`
          UPDATE dbo.Admins
          SET full_name = CAST(${full_name} AS NVARCHAR(150))
          WHERE user_id = ${user_id};
        `
      : async () => ({ rowsAffected: [1] });

    selectProfile = () => sql.query`
      SELECT full_name
      FROM dbo.Admins
      WHERE user_id = ${user_id};
    `;
  } else {
    return next(new AppError("Profile update is not allowed", 403));
  }

  const result = await updateProfile();
  if (result.rowsAffected[0] === 0) {
    return next(new AppError("Profile not found", 404));
  }

  const profile = selectProfile ? (await selectProfile()).recordset[0] : null;
  if (user_type === "doctor" || user_type === "clinic" || user_type === "staff") {
    attachGeoLocation(profile);
  }

  res.status(200).json({
    status: "success",
    message: "تم تحديث الملف الشخصي بنجاح",
    photo,
    profile,
  });
});

exports.userStats = catchAsync(async (req, res) => {

  const doctorsQuery = sql.query(`
      SELECT COUNT(*) AS count
      FROM Doctors
      WHERE is_verified = 1
  `);

  const staffQuery = sql.query(`
      SELECT COUNT(*) AS count
      FROM Staff
      WHERE is_verified = 1
  `);

  const clinicsQuery = sql.query(`
      SELECT COUNT(*) AS count
      FROM Clinics
      WHERE status = 'approved'
  `);

  const patientsQuery = sql.query(`
      SELECT COUNT(*) AS count
      FROM Patients
  `);

  const [
    doctors,
    staff,
    clinics,
    patients
  ] = await Promise.all([
    doctorsQuery,
    staffQuery,
    clinicsQuery,
    patientsQuery
  ]);

  const totalDoctors =
    doctors.recordset[0].count;

  const totalStaff =
    staff.recordset[0].count;

  const totalClinics =
    clinics.recordset[0].count;

  const totalPatients =
    patients.recordset[0].count;

  res.status(200).json({
    status: "success",
    data: {
      totalDoctors,
      totalStaff,
      totalClinics,
      totalPatients,
      totalMedicalUsers: totalDoctors + totalStaff
    }
  });

});
