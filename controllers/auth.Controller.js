const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");
const {
  attachGeoLocation,
  normalizeGeoLocation,
} = require("../utilts/geo.Location");
const Email = require("../utilts/email");

const PASSWORD_RESET_TOKEN_BYTES = 32;
const DEFAULT_PASSWORD_RESET_EXPIRES_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_OTP_EXPIRES_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_OTP_DIGITS = 6;
const MIN_PASSWORD_RESET_OTP_DIGITS = 4;
const MAX_PASSWORD_RESET_OTP_DIGITS = 8;

const getPasswordResetExpiresMinutes = () => {
  const minutes = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES);

  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.floor(minutes);
  }

  return DEFAULT_PASSWORD_RESET_EXPIRES_MINUTES;
};

const getPasswordResetOtpExpiresMinutes = () => {
  const minutes = Number(process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES);

  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.floor(minutes);
  }

  return DEFAULT_PASSWORD_RESET_OTP_EXPIRES_MINUTES;
};

const getPasswordResetOtpDigits = () => {
  const digits = Number(process.env.PASSWORD_RESET_OTP_DIGITS);

  if (Number.isFinite(digits)) {
    const normalizedDigits = Math.floor(digits);

    if (
      normalizedDigits >= MIN_PASSWORD_RESET_OTP_DIGITS &&
      normalizedDigits <= MAX_PASSWORD_RESET_OTP_DIGITS
    ) {
      return normalizedDigits;
    }
  }

  return DEFAULT_PASSWORD_RESET_OTP_DIGITS;
};

const generatePasswordResetOtp = (digits) => {
  const maxValue = 10 ** digits;
  return String(crypto.randomInt(0, maxValue)).padStart(digits, "0");
};

const hashPasswordResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const hashPasswordResetOtp = (otp) =>
  crypto.createHash("sha256").update(otp).digest("hex");

const buildPasswordResetUrl = (req, token) => {
  const frontendResetUrl = process.env.PASSWORD_RESET_URL;

  if (frontendResetUrl) {
    return frontendResetUrl.replace(":token", token);
  }

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  return `${frontendUrl.replace(/\/$/, "")}/reset-password/${token}`;
};

const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });

const sendAccessCookie = (res, token) => {
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const sendRefreshCookie = (res, token) => {
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

const sendDoctorPendingVerificationEmail = async ({ email, profile }) => {
  try {
    await new Email({
      email,
      name: profile?.full_name || email,
    }).sendDoctorPendingVerification();
  } catch (err) {
    console.error(
      "Failed to send doctor pending verification email:",
      err.message,
    );
  }
};

const sendSignupWelcomeEmail = async ({ email, profile }) => {
  try {
    await new Email({
      email,
      name: profile?.full_name || email,
    }).sendWelcome();
  } catch (err) {
    console.error("Failed to send signup welcome email:", err.message);
  }
};

const getAccountName = (profile, email) =>
  (profile?.full_name || profile?.name).trim();

const getClinicName = (profile) => (profile?.name || profile?.full_name).trim();

const getStaffClinicName = (profile) => {
  const legacyClinicName =
    profile?.name && profile.name !== profile.full_name ? profile.name : null;
  const clinicName =
    profile?.clinic_name ||
    profile?.clinicName ||
    profile?.clinic ||
    legacyClinicName;
  return typeof clinicName === "string" ? clinicName.trim() : "";
};

const normalizeWorkDays = (workDays) =>
  Array.isArray(workDays) ? workDays.join(",") : workDays || null;

const nullable = (value) =>
  value === undefined || value === "" ? null : value;

const getDoctorProfileByUserId = async (userId) => {
  const profile = (
    await sql.query`
      SELECT
        doctor_id,
        full_name,
        gender,
        phone,
        specialist,
        work_days,
        CONVERT(VARCHAR(5), work_from, 108) AS work_from,
        CONVERT(VARCHAR(5), work_to, 108) AS work_to,
        consultation_price,
        location,
        geo_location.Lat AS geo_location_latitude,
        geo_location.Long AS geo_location_longitude,
        years_of_experience,
        bio,
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
      WHERE user_id = ${userId};
    `
  ).recordset[0];

  if (profile) {
    attachGeoLocation(profile);
  }

  return profile;
};

const getStaffProfileByUserId = async (userId) => {
  const profile = (
    await sql.query`
      SELECT
        s.staff_id,
        s.full_name,
        s.phone,
        s.gender,
        s.years_of_experience,
        s.bio,
        s.specialist,
        s.work_days,
        CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
        CONVERT(VARCHAR(5), s.work_to, 108) AS work_to,
        s.consultation_price,
        s.location,
        s.geo_location.Lat AS geo_location_latitude,
        s.geo_location.Long AS geo_location_longitude,
        s.is_verified,
        s.clinic_id,
        c.name AS clinic_name,
        c.location AS clinic_location,
        c.geo_location.Lat AS clinic_geo_location_latitude,
        c.geo_location.Long AS clinic_geo_location_longitude,
        ISNULL(rt.total_ratings, 0) AS total_ratings,
        CAST(ISNULL(rt.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
      FROM dbo.Staff s
      JOIN dbo.Clinics c
        ON c.clinic_id = s.clinic_id
      OUTER APPLY (
        SELECT
          COUNT(*) AS total_ratings,
          ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
        FROM dbo.Ratings r
        WHERE r.staff_id = s.staff_id
      ) rt
      WHERE s.user_id = ${userId};
    `
  ).recordset[0];

  if (profile) {
    attachGeoLocation(profile);
    attachGeoLocation(profile, { targetKey: "clinic_geo_location" });
  }

  return profile;
};

exports.signup = catchAsync(async (req, res, next) => {
  const { email, password, user_type, profile, photo } = req.body;

  const exists = await sql.query`
    SELECT user_id FROM dbo.Users WHERE email = ${email};
  `;
  if (exists.recordset.length) {
    return next(new AppError("Email is already in use", 409));
  }

  if (user_type === "clinic") {
    const clinicExists = await sql.query`
      SELECT clinic_id
      FROM dbo.Clinics
      WHERE name = ${profile.name}
        OR email = ${profile.email || email};
    `;

    if (clinicExists.recordset.length) {
      return next(new AppError("Clinic name or email is already in use", 409));
    }
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const transaction = new sql.Transaction(sql.globalConnectionPool);
  let transactionStarted = false;
  let user;
  const roleIds = {
    patientid: null,
    doctorid: null,
    clinicid: null,
    staffid: null,
  };

  try {
    await transaction.begin();
    transactionStarted = true;

    const accountPhoto = photo || profile?.photo || null;

    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type, photo)
      OUTPUT INSERTED.user_id, INSERTED.user_type
      VALUES (${email}, ${hashedPassword}, ${user_type}, ${accountPhoto});
    `;

    user = userResult.recordset[0];

    if (user_type === "patient") {
      const { date_of_birth, gender, phone } = profile;
      const full_name = getAccountName(profile);

      const patientResult = await transaction.request().query`
        INSERT INTO dbo.Patients
        (user_id, full_name, date_of_birth, gender, phone)
        OUTPUT INSERTED.patient_id
        VALUES
        (${user.user_id}, ${full_name}, ${date_of_birth || null},
         ${gender || null}, ${phone || null});
      `;

      roleIds.patientid = patientResult.recordset[0].patient_id;
    }
    if (user_type === "doctor") {
      const {
        license_number,
        gender,
        phone,
        years_of_experience,
        bio,
        consultation_price,
        specialist,
        work_days,
        work_from,
        work_to,
        location,
        geo_location,
      } = profile;
      const full_name = getAccountName(profile);
      const normalizedWorkDays = normalizeWorkDays(work_days);
      const doctorGeoLocation = normalizeGeoLocation(
        geo_location,
        "profile.geo_location",
      );

      if (doctorGeoLocation) {
        const doctorResult = await transaction.request().query`
          INSERT INTO dbo.Doctors
          (user_id, full_name, license_number, gender, phone, years_of_experience,
           bio, consultation_price, specialist, work_days, work_from, work_to, location,
           geo_location)
          OUTPUT INSERTED.doctor_id
          VALUES
          (${user.user_id}, ${full_name}, ${nullable(license_number)}, ${gender || null}, ${phone || null},
           ${nullable(years_of_experience)}, ${bio || null}, ${nullable(consultation_price)},
           ${specialist || null}, ${normalizedWorkDays}, ${work_from || null}, ${work_to || null}, ${location || null},
           geography::Point(${doctorGeoLocation.latitude}, ${doctorGeoLocation.longitude}, 4326));
        `;
        roleIds.doctorid = doctorResult.recordset[0].doctor_id;
      } else {
        const doctorResult = await transaction.request().query`
          INSERT INTO dbo.Doctors
          (user_id, full_name, license_number, gender, phone, years_of_experience,
           bio, consultation_price, specialist, work_days, work_from, work_to, location,
           geo_location)
          OUTPUT INSERTED.doctor_id
          VALUES
          (${user.user_id}, ${full_name}, ${nullable(license_number)}, ${gender || null}, ${phone || null},
           ${nullable(years_of_experience)}, ${bio || null}, ${nullable(consultation_price)},
           ${specialist || null}, ${normalizedWorkDays}, ${work_from || null}, ${work_to || null}, ${location || null},
           CAST(NULL AS GEOGRAPHY));
        `;
        roleIds.doctorid = doctorResult.recordset[0].doctor_id;
      }

      const admins = await transaction.request().query`
        SELECT user_id FROM dbo.Admins;
      `;

      for (const admin of admins.recordset) {
        await createNotification({
          user_id: admin.user_id,
          title: "طلب توثيق طبيب",
          message: `يوجد حساب طبيب جديد باسم "${full_name}" بانتظار التوثيق.`,
        });
      }
    }
    if (user_type === "clinic") {
      const {
        address,
        location,
        phone,
        email: clinic_email,
        geo_location,
      } = profile;
      const name = getClinicName(profile);
      const clinicGeoLocation = normalizeGeoLocation(
        geo_location,
        "profile.geo_location",
      );
      const contactEmail = clinic_email || email;

      if (clinicGeoLocation) {
        const clinicResult = await transaction.request().query`
          INSERT INTO dbo.Clinics
            (owner_user_id, name, address, location, phone, email, status, geo_location)
          OUTPUT INSERTED.clinic_id
          VALUES
            (${user.user_id}, ${name}, ${address || null}, ${location || null},
             ${phone || null}, ${contactEmail}, 'pending',
             geography::Point(${clinicGeoLocation.latitude}, ${clinicGeoLocation.longitude}, 4326));
        `;
        roleIds.clinicid = clinicResult.recordset[0].clinic_id;
      } else {
        const clinicResult = await transaction.request().query`
          INSERT INTO dbo.Clinics
            (owner_user_id, name, address, location, phone, email, status, geo_location)
          OUTPUT INSERTED.clinic_id
          VALUES
            (${user.user_id}, ${name}, ${address || null}, ${location || null},
             ${phone || null}, ${contactEmail}, 'pending',
             CAST(NULL AS GEOGRAPHY));
        `;
        roleIds.clinicid = clinicResult.recordset[0].clinic_id;
      }

      const admins = await transaction.request().query`
        SELECT user_id FROM dbo.Admins;
      `;

      for (const admin of admins.recordset) {
        await createNotification({
          user_id: admin.user_id,
          title: "طلب اعتماد عيادة",
          message: `تم إرسال طلب عيادة باسم "${name}" وهو بانتظار المراجعة.`,
        });
      }
    }
    if (user_type === "staff") {
      const {
        years_of_experience,
        location,
        gender,
        specialist,
        work_days,
        work_from,
        work_to,
        consultation_price,
        phone,
      } = profile;
      const full_name = getAccountName(profile);
      const clinicName = getStaffClinicName(profile);
      const normalizedWorkDays = normalizeWorkDays(work_days);
      let clinic = null;

      if (!clinicName) {
        throw new AppError("Clinic name is required", 400);
      }

      clinic = (
        await transaction.request().query`
          SELECT clinic_id, name, owner_user_id
          FROM dbo.Clinics
          WHERE name = ${clinicName}
            AND status = 'approved';
        `
      ).recordset[0];

      if (!clinic) {
        throw new AppError("Clinic not found or not approved", 400);
      }

      const normalizedPrice =
        consultation_price === undefined ||
        consultation_price === null ||
        consultation_price === ""
          ? null
          : Number(consultation_price);

      if (normalizedPrice !== null && (Number.isNaN(normalizedPrice) || normalizedPrice < 0)) {
        throw new AppError(
          "consultation_price must be a valid non-negative number",
          400,
        );
      }

      // Insert staff
      const staffResult = await transaction.request().query`
    INSERT INTO dbo.Staff
    (
      user_id,
      clinic_id,
      full_name,
      phone,
      specialist,
      work_days,
      work_from,
      work_to,
      consultation_price,
      is_verified
    )
    OUTPUT INSERTED.staff_id
    VALUES
    (
      ${user.user_id},
      ${clinic.clinic_id},
      ${full_name},
      ${phone || null},
      ${specialist || null},
      ${normalizedWorkDays},
      ${work_from || null},
      ${work_to || null},
      ${normalizedPrice},
      0
    );
  `;

      user.clinic_name = clinic?.name;
      roleIds.clinicid = clinic.clinic_id;
      roleIds.staffid = staffResult.recordset[0].staff_id;

      await createNotification({
        user_id: clinic.owner_user_id,
        title: "طلب توثيق موظف",
        message: `يوجد حساب موظف جديد باسم "${full_name}" بانتظار التوثيق.`,
      });
    }

    await transaction.commit();
  } catch (err) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error(
          "Failed to roll back signup transaction:",
          rollbackErr.message,
        );
      }
    }
    return next(err);
  }

  if (user_type === "doctor") {
    await sendDoctorPendingVerificationEmail({ email, profile });
  } else {
    await sendSignupWelcomeEmail({ email, profile });
  }

  let signupProfile = null;

  if (user_type === "doctor") {
    signupProfile = await getDoctorProfileByUserId(user.user_id);
  }

  if (user_type === "staff") {
    signupProfile = await getStaffProfileByUserId(user.user_id);
  }

  const accessToken = signAccessToken({
    user_id: user.user_id,
    role: user.user_type,
  });

  const refreshToken = signRefreshToken({ user_id: user.user_id });

  sendAccessCookie(res, accessToken);
  sendRefreshCookie(res, refreshToken);

  res.status(201).json({
    status: "success",
    user: {
      user_id: user.user_id,
      email,
      role: user.user_type,
      patient_id: user.user_type === "patient" ? roleIds.patientid : undefined,
      doctor_id: user.user_type === "doctor" ? roleIds.doctorid : undefined,
      clinic_id: user.user_type === "clinic" ? roleIds.clinicid : undefined,
      staff_id: user.user_type === "staff" ? roleIds.staffid : undefined,
      clinic_name: user.user_type === "staff" ? user.clinic_name : undefined,
      profile: signupProfile || undefined,
    },
  });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  const user = (
    await sql.query`
      SELECT user_id, email, password, photo, user_type, is_active
      FROM dbo.Users
      WHERE email = ${email} AND is_active = 1;
    `
  ).recordset[0];

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return next(new AppError("Incorrect email or password", 401));
  }

  let profile = null;

  if (user.user_type === "patient") {
    profile = (
      await sql.query`
        SELECT
          patient_id,
          full_name,
          CONVERT(VARCHAR(10), date_of_birth, 120) AS date_of_birth,
          gender,
          phone
        FROM dbo.Patients WHERE user_id = ${user.user_id};
      `
    ).recordset[0];
  }

  if (user.user_type === "doctor") {
    profile = await getDoctorProfileByUserId(user.user_id);
  }

  if (user.user_type === "staff") {
    profile = await getStaffProfileByUserId(user.user_id);
  }

  if (user.user_type === "clinic") {
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
        WHERE owner_user_id = ${user.user_id};
      `
    ).recordset[0];

    attachGeoLocation(profile);
  }

  if (user.user_type === "admin") {
    profile = (
      await sql.query`
        SELECT admin_id, full_name FROM dbo.Admins WHERE user_id = ${user.user_id};
      `
    ).recordset[0];
  }

  const accessToken = signAccessToken({
    user_id: user.user_id,
    role: user.user_type,
  });

  const refreshToken = signRefreshToken({ user_id: user.user_id });

  sendAccessCookie(res, accessToken);
  sendRefreshCookie(res, refreshToken);

  res.status(200).json({
    status: "success",
    user: {
      user_id: user.user_id,
      email: user.email,
      photo: user.photo,
      role: user.user_type,
      profile,
    },
  });
});

exports.refreshToken = catchAsync(async (req, res, next) => {
  const token = req.cookies.refresh_token;
  if (!token) return next(new AppError("Refresh token is missing", 401));

  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

  const user = (
    await sql.query`
      SELECT user_id, user_type
      FROM dbo.Users
      WHERE user_id = ${decoded.user_id} AND is_active = 1;
    `
  ).recordset[0];

  if (!user) return next(new AppError("User not found", 401));

  const accessToken = signAccessToken({
    user_id: user.user_id,
    role: user.user_type,
  });

  sendAccessCookie(res, accessToken);

  res.status(200).json({ status: "success" });
});

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  const user = (
    await sql.query`
      SELECT user_id, email
      FROM dbo.Users
      WHERE email = ${email} AND is_active = 1;
    `
  ).recordset[0];

  const responseMessage =
    "If an active account exists for this email, a password reset code has been sent.";

  if (!user) {
    return res.status(200).json({
      status: "success",
      message: responseMessage,
    });
  }

  const otpDigits = getPasswordResetOtpDigits();
  const otpCode = generatePasswordResetOtp(otpDigits);
  const hashedOtpCode = hashPasswordResetOtp(otpCode);
  const expiresMinutes = getPasswordResetOtpExpiresMinutes();

  await sql.query`
    UPDATE dbo.Users
    SET password_reset_otp = ${hashedOtpCode},
        password_reset_otp_expires = DATEADD(MINUTE, ${expiresMinutes}, SYSDATETIME()),
        password_reset_token = NULL,
        password_reset_expires = NULL
    WHERE user_id = ${user.user_id};
  `;

  try {
    await new Email({ email: user.email }).sendPasswordResetOtp({
      otpCode,
      expiresMinutes,
    });
  } catch (err) {
    await sql.query`
      UPDATE dbo.Users
      SET password_reset_otp = NULL,
          password_reset_otp_expires = NULL,
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE user_id = ${user.user_id};
    `;

    return next(
      new AppError(
        "Could not send password reset email. Please try again later.",
        500,
      ),
    );
  }

  res.status(200).json({
    status: "success",
    message: responseMessage,
  });
});

exports.verifyPasswordResetOtp = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;
  const hashedOtpCode = hashPasswordResetOtp(otp);

  const user = (
    await sql.query`
      SELECT user_id
      FROM dbo.Users
      WHERE email = ${email}
        AND password_reset_otp = ${hashedOtpCode}
        AND password_reset_otp_expires > SYSDATETIME()
        AND is_active = 1;
    `
  ).recordset[0];

  if (!user) {
    return next(new AppError("Reset code is invalid or has expired", 400));
  }

  const resetToken = crypto
    .randomBytes(PASSWORD_RESET_TOKEN_BYTES)
    .toString("hex");
  const hashedResetToken = hashPasswordResetToken(resetToken);
  const expiresMinutes = getPasswordResetExpiresMinutes();

  await sql.query`
    UPDATE dbo.Users
    SET password_reset_token = ${hashedResetToken},
        password_reset_expires = DATEADD(MINUTE, ${expiresMinutes}, SYSDATETIME()),
        password_reset_otp = NULL,
        password_reset_otp_expires = NULL
    WHERE user_id = ${user.user_id};
  `;

  const resetUrl = buildPasswordResetUrl(req, resetToken);

  res.status(200).json({
    status: "success",
    message: "Reset code verified.",
    reset_token: resetToken,
    reset_url: resetUrl,
    expires_minutes: expiresMinutes,
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;
  const hashedResetToken = hashPasswordResetToken(token);

  const user = (
    await sql.query`
      SELECT user_id
      FROM dbo.Users
      WHERE password_reset_token = ${hashedResetToken}
        AND password_reset_expires > SYSDATETIME()
        AND is_active = 1;
    `
  ).recordset[0];

  if (!user) {
    return next(
      new AppError("Password reset token is invalid or has expired", 400),
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await sql.query`
    UPDATE dbo.Users
    SET password = ${hashedPassword},
        password_reset_token = NULL,
        password_reset_expires = NULL,
        password_reset_otp = NULL,
        password_reset_otp_expires = NULL
    WHERE user_id = ${user.user_id};
  `;

  res.cookie("jwt", "", { expires: new Date(0) });
  res.cookie("refresh_token", "", { expires: new Date(0) });

  res.status(200).json({
    status: "success",
    message:
      "Password has been reset successfully. Please log in with your new password.",
  });
});

exports.logout = (req, res) => {
  res.cookie("jwt", "", { expires: new Date(0) });
  res.cookie("refresh_token", "", { expires: new Date(0) });

  res.status(200).json({
    status: "success",
    message: "تم تسجيل الخروج بنجاح",
  });
};
