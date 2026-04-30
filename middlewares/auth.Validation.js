const AppError = require("../utilts/app.Error");
const { normalizeGeoLocation } = require("../utilts/geo.Location");

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;
const ALLOWED_SIGNUP_ROLES = ["patient", "doctor", "staff"];
const STAFF_ROLES = ["doctor", "nurse", "receptionist"];

exports.signupValidation = (req, res, next) => {
  const { email, password, user_type, profile } = req.body;

  if (!email || !password || !user_type) {
    return next(
      new AppError("Email, password, and user_type are required", 400),
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  if (typeof password !== "string" || password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  if (!ALLOWED_SIGNUP_ROLES.includes(user_type)) {
    return next(new AppError("Invalid user_type", 400));
  }

  if (!profile || typeof profile !== "object") {
    return next(new AppError("Profile data is required", 400));
  }

  if (user_type === "patient") {
    if (!profile.full_name) {
      return next(new AppError("patient full_name is required", 400));
    }
  }

  if (user_type === "doctor") {
    const {
      full_name,
      license_number,
      specialist,
      work_days,
      work_from,
      work_to,
    } = profile;

    if (
      !full_name ||
      !license_number ||
      !specialist ||
      !work_days ||
      !work_from ||
      !work_to
    ) {
      return next(
        new AppError(
          "Doctor fields full_name, license_number, specialist, work_days, work_from, and work_to are required",
          400,
        ),
      );
    }

    if (!TIME_REGEX.test(work_from) || !TIME_REGEX.test(work_to)) {
      return next(new AppError("Invalid doctor working time format", 400));
    }

    try {
      normalizeGeoLocation(profile.geo_location, "profile.geo_location");
    } catch (err) {
      return next(err);
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

    if (!full_name || !clinic_id || !role_title) {
      return next(
        new AppError(
          "Staff fields full_name, clinic_id, and role_title are required",
          400,
        ),
      );
    }

    if (!STAFF_ROLES.includes(role_title)) {
      return next(new AppError("Invalid staff role_title value", 400));
    }

    if (!Number.isInteger(Number(clinic_id)) || Number(clinic_id) <= 0) {
      return next(
        new AppError("clinic_id must be a positive integer", 400),
      );
    }

    if (role_title === "doctor") {
      if (
        !specialist ||
        !work_days ||
        !work_from ||
        !work_to ||
        consultation_price === undefined ||
        consultation_price === null
      ) {
        return next(
          new AppError(
            "Staff doctor requires specialist, work_days, work_from, work_to, and consultation_price",
            400,
          ),
        );
      }

      if (!TIME_REGEX.test(work_from) || !TIME_REGEX.test(work_to)) {
        return next(new AppError("Invalid staff doctor working time format", 400));
      }

      if (
        Number.isNaN(Number(consultation_price)) ||
        Number(consultation_price) < 0
      ) {
        return next(
          new AppError(
            "consultation_price must be a valid non-negative number",
            400,
          ),
        );
      }
    } else {
      if (
        specialist !== undefined ||
        work_days !== undefined ||
        work_from !== undefined ||
        work_to !== undefined ||
        consultation_price !== undefined
      ) {
        return next(
          new AppError(
            "specialist, work_days, work_from, work_to, and consultation_price are allowed only for staff doctors",
            400,
          ),
        );
      }
    }
  }

  next();
};

exports.loginValidation = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  next();
};

exports.forgotPasswordValidation = (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new AppError("Email is required", 400));
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  next();
};

exports.resetPasswordValidation = (req, res, next) => {
  const { token } = req.params;
  const { password, confirm_password } = req.body;

  if (!token) {
    return next(new AppError("Password reset token is required", 400));
  }

  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    return next(new AppError("Invalid password reset token format", 400));
  }

  if (!password) {
    return next(new AppError("Password is required", 400));
  }

  if (typeof password !== "string" || password.length < 8) {
    return next(new AppError("Password must be at least 8 characters", 400));
  }

  if (confirm_password !== undefined && confirm_password !== password) {
    return next(new AppError("Password confirmation does not match", 400));
  }

  next();
};

exports.refreshValidation = (req, res, next) => {
  if (!req.cookies || !req.cookies.refresh_token) {
    return next(new AppError("Refresh token is missing", 401));
  }

  next();
};
