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

const getPasswordResetExpiresMinutes = () => {
  const minutes = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES);

  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.floor(minutes);
  }

  return DEFAULT_PASSWORD_RESET_EXPIRES_MINUTES;
};

const hashPasswordResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

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
    console.error("Failed to send doctor pending verification email:", err.message);
  }
};

exports.signup = catchAsync(async (req, res, next) => {
  const { email, password, user_type, profile } = req.body;

  const exists = await sql.query`
    SELECT user_id FROM dbo.Users WHERE email = ${email};
  `;
  if (exists.recordset.length) {
    return next(new AppError("Email is already in use", 409));
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const transaction = new sql.Transaction();
  await transaction.begin();

  try {
    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type)
      OUTPUT INSERTED.user_id, INSERTED.user_type
      VALUES (${email}, ${hashedPassword}, ${user_type});
    `;

    const user = userResult.recordset[0];

    if (user_type === "patient") {
      const { full_name, date_of_birth, gender, phone } = profile;

      await transaction.request().query`
        INSERT INTO dbo.Patients
        (user_id, full_name, date_of_birth, gender, phone)
        VALUES
        (${user.user_id}, ${full_name}, ${date_of_birth || null},
         ${gender || null}, ${phone || null});
      `;
    }
    if (user_type === "doctor") {
      const {
        full_name,
        license_number,
        gender,
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
      const doctorGeoLocation = normalizeGeoLocation(geo_location, "profile.geo_location");

      if (doctorGeoLocation) {
        await transaction.request().query`
          INSERT INTO dbo.Doctors
          (user_id, full_name, license_number, gender, years_of_experience,
           bio, consultation_price, specialist, work_days, work_from, work_to, location,
           geo_location)
          VALUES
          (${user.user_id}, ${full_name}, ${license_number}, ${gender || null},
           ${years_of_experience || null}, ${bio || null}, ${consultation_price || null},
           ${specialist}, ${work_days}, ${work_from}, ${work_to}, ${location || null},
           geography::Point(${doctorGeoLocation.latitude}, ${doctorGeoLocation.longitude}, 4326));
        `;
      } else {
        await transaction.request().query`
          INSERT INTO dbo.Doctors
          (user_id, full_name, license_number, gender, years_of_experience,
           bio, consultation_price, specialist, work_days, work_from, work_to, location,
           geo_location)
          VALUES
          (${user.user_id}, ${full_name}, ${license_number}, ${gender || null},
           ${years_of_experience || null}, ${bio || null}, ${consultation_price || null},
           ${specialist}, ${work_days}, ${work_from}, ${work_to}, ${location || null},
           CAST(NULL AS GEOGRAPHY));
        `;
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
    if (user_type === "staff") {
      const {
        full_name,
        clinic_id,
        role_title,
        specialist,
        work_days,
        work_from,
        work_to,
        consultation_price,
      } = profile;

      const clinic = (
        await transaction.request().query`
          SELECT clinic_id, owner_user_id
          FROM dbo.Clinics
          WHERE clinic_id = ${clinic_id} AND status = 'approved';
        `
      ).recordset[0];

      if (!clinic) {
        throw new AppError("Clinic not found or not approved", 400);
      }

      await transaction.request().query`
        INSERT INTO dbo.Staff
        (user_id, clinic_id, full_name, role_title, specialist,
         work_days, work_from, work_to, consultation_price, is_verified)
        VALUES
        (${user.user_id}, ${clinic_id}, ${full_name}, ${role_title},
         ${role_title === "doctor" ? specialist : null},
         ${role_title === "doctor" ? work_days : null},
         ${role_title === "doctor" ? work_from : null},
         ${role_title === "doctor" ? work_to : null},
         ${role_title === "doctor" ? consultation_price : null},
         0);
      `;

      await createNotification({
        user_id: clinic.owner_user_id,
        title: "طلب توثيق موظف",
        message: `يوجد حساب موظف جديد باسم "${full_name}" بانتظار التوثيق.`,
      });
    }

    await transaction.commit();

    if (user_type === "doctor") {
      await sendDoctorPendingVerificationEmail({ email, profile });
    } else {
      await sendSignupWelcomeEmail({ email, profile });
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
      },
    });
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
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
        SELECT full_name, date_of_birth, gender, phone
        FROM dbo.Patients WHERE user_id = ${user.user_id};
      `
    ).recordset[0];
  }

  if (user.user_type === "doctor") {
    profile = (
      await sql.query`
        SELECT
          full_name,
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
          is_verified
        FROM dbo.Doctors WHERE user_id = ${user.user_id};
      `
    ).recordset[0];

    attachGeoLocation(profile);

    const clinic = (
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

    if (clinic && profile) {
      profile.clinic = attachGeoLocation(clinic);
    }
  }

  if (user.user_type === "staff") {
    profile = (
      await sql.query`
        SELECT
          s.full_name,
          s.clinic_id,
          s.role_title,
          s.specialist,
          s.work_days,
          CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
          CONVERT(VARCHAR(5), s.work_to, 108) AS work_to,
          s.consultation_price,
          s.is_verified,
          c.name AS clinic_name,
          c.location AS clinic_location,
          c.geo_location.Lat AS clinic_geo_location_latitude,
          c.geo_location.Long AS clinic_geo_location_longitude
        FROM dbo.Staff s
        JOIN dbo.Clinics c
          ON c.clinic_id = s.clinic_id
        WHERE s.user_id = ${user.user_id};
      `
    ).recordset[0];

    attachGeoLocation(profile, { targetKey: "clinic_geo_location" });
  }

  if (user.user_type === "admin") {
    profile = (
      await sql.query`
        SELECT full_name FROM dbo.Admins WHERE user_id = ${user.user_id};
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
    "If an active account exists for this email, a password reset message has been sent.";

  if (!user) {
    return res.status(200).json({
      status: "success",
      message: responseMessage,
    });
  }

  const resetToken = crypto
    .randomBytes(PASSWORD_RESET_TOKEN_BYTES)
    .toString("hex");
  const hashedResetToken = hashPasswordResetToken(resetToken);
  const expiresMinutes = getPasswordResetExpiresMinutes();

  await sql.query`
    UPDATE dbo.Users
    SET password_reset_token = ${hashedResetToken},
        password_reset_expires = DATEADD(MINUTE, ${expiresMinutes}, SYSDATETIME())
    WHERE user_id = ${user.user_id};
  `;

  const resetUrl = buildPasswordResetUrl(req, resetToken);

  try {
    await new Email({ email: user.email }, resetUrl).sendPasswordReset({
      expiresMinutes,
    });
  } catch (err) {
    await sql.query`
      UPDATE dbo.Users
      SET password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE user_id = ${user.user_id};
    `;

    return next(
      new AppError("Could not send password reset email. Please try again later.", 500),
    );
  }

  res.status(200).json({
    status: "success",
    message: responseMessage,
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
    return next(new AppError("Password reset token is invalid or has expired", 400));
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await sql.query`
    UPDATE dbo.Users
    SET password = ${hashedPassword},
        password_reset_token = NULL,
        password_reset_expires = NULL
    WHERE user_id = ${user.user_id};
  `;

  res.cookie("jwt", "", { expires: new Date(0) });
  res.cookie("refresh_token", "", { expires: new Date(0) });

  res.status(200).json({
    status: "success",
    message: "Password has been reset successfully. Please log in with your new password.",
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
