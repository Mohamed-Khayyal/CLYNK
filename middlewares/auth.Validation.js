const AppError = require("../utilts/app.Error");
const { normalizeGeoLocation } = require("../utilts/geo.Location");

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const ALLOWED_SIGNUP_ROLES = ["patient", "doctor", "staff", "clinic"];
const DEFAULT_PASSWORD_RESET_OTP_DIGITS = 6;
const MIN_PASSWORD_RESET_OTP_DIGITS = 4;
const MAX_PASSWORD_RESET_OTP_DIGITS = 8;

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

const normalizeSignupName = (bodyName, profile, userType) => {
  const rawName =
    bodyName ||
    profile?.full_name ||
    (userType === "clinic" ? profile?.name : null) ||
    profile?.name;
  return typeof rawName === "string" ? rawName.trim() : "";
};

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

exports.signupValidation = (req, res, next) => {
  const { email, password, user_type, profile, name } = req.body;

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

  if (profile !== undefined && (!profile || typeof profile !== "object")) {
    return next(new AppError("Profile data must be an object", 400));
  }

  const normalizedProfile = profile ? { ...profile } : {};
  const signupName = normalizeSignupName(name, normalizedProfile, user_type);

  if (!signupName) {
    return next(new AppError("Name is required", 400));
  }

  normalizedProfile.name = normalizedProfile.name || signupName;
  normalizedProfile.full_name = normalizedProfile.full_name || signupName;
  req.body.name = signupName;
  req.body.profile = normalizedProfile;

  if (user_type === "doctor") {
    try {
      normalizeGeoLocation(normalizedProfile.geo_location, "profile.geo_location");
    } catch (err) {
      return next(err);
    }
  }

  if (user_type === "staff") {
    const clinicName = getStaffClinicName(normalizedProfile);

    if (!clinicName) {
      return next(new AppError("Clinic name is required", 400));
    }

    normalizedProfile.clinic_name = clinicName;
  }

  if (user_type === "clinic") {
    const { email: clinic_email, geo_location } = normalizedProfile;

    if (clinic_email && !EMAIL_REGEX.test(clinic_email)) {
      return next(new AppError("Invalid clinic email format", 400));
    }

    try {
      normalizeGeoLocation(geo_location, "profile.geo_location");
    } catch (err) {
      return next(err);
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

exports.verifyPasswordResetOtpValidation = (req, res, next) => {
  const { email, otp } = req.body;

  if (!email) {
    return next(new AppError("Email is required", 400));
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  if (!otp) {
    return next(new AppError("OTP code is required", 400));
  }

  if (typeof otp !== "string") {
    return next(new AppError("OTP code must be a string", 400));
  }

  const normalizedOtp = otp.trim();
  const otpDigits = getPasswordResetOtpDigits();
  const otpRegex = new RegExp(`^\\d{${otpDigits}}$`);

  if (!otpRegex.test(normalizedOtp)) {
    return next(
      new AppError(`OTP code must be ${otpDigits} digits`, 400),
    );
  }

  req.body.otp = normalizedOtp;
  next();
};

exports.refreshValidation = (req, res, next) => {
  if (!req.cookies || !req.cookies.refresh_token) {
    return next(new AppError("Refresh token is missing", 401));
  }

  next();
};
