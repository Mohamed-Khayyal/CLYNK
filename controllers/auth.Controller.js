const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");
const { normalizeGeoLocation } = require("../utilts/geo.Location");
const Email = require("../utilts/email");

const User = require("../models/User.model");
const Admin = require("../models/Admin.model");
const Doctor = require("../models/Doctor.model");
const Patient = require("../models/Patient.model");
const Clinic = require("../models/Clinic.model");
const Staff = require("../models/Staff.model");
const Rating = require("../models/Rating.model");

const PASSWORD_RESET_TOKEN_BYTES = 32;
const DEFAULT_PASSWORD_RESET_EXPIRES_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_OTP_EXPIRES_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_OTP_DIGITS = 6;
const MIN_PASSWORD_RESET_OTP_DIGITS = 4;
const MAX_PASSWORD_RESET_OTP_DIGITS = 8;

const getPasswordResetExpiresMinutes = () => {
  const minutes = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes);
  return DEFAULT_PASSWORD_RESET_EXPIRES_MINUTES;
};

const getPasswordResetOtpExpiresMinutes = () => {
  const minutes = Number(process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes);
  return DEFAULT_PASSWORD_RESET_OTP_EXPIRES_MINUTES;
};

const getPasswordResetOtpDigits = () => {
  const digits = Number(process.env.PASSWORD_RESET_OTP_DIGITS);
  if (Number.isFinite(digits)) {
    const n = Math.floor(digits);
    if (n >= MIN_PASSWORD_RESET_OTP_DIGITS && n <= MAX_PASSWORD_RESET_OTP_DIGITS) return n;
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
  if (frontendResetUrl) return frontendResetUrl.replace(":token", token);
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  return `${frontendUrl.replace(/\/$/, "")}/reset-password/${token}`;
};

const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

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
    await new Email({ email, name: profile?.full_name || email }).sendDoctorPendingVerification();
  } catch (err) {
    console.error("Failed to send doctor pending verification email:", err.message);
  }
};

const sendSignupWelcomeEmail = async ({ email, profile }) => {
  try {
    await new Email({ email, name: profile?.full_name || email }).sendWelcome();
  } catch (err) {
    console.error("Failed to send signup welcome email:", err.message);
  }
};

const getAccountName = (profile) => (profile?.full_name || profile?.name || "").trim();
const getClinicName = (profile) => (profile?.name || profile?.full_name || "").trim();

const getStaffClinicName = (profile) => {
  const legacyClinicName = profile?.name && profile.name !== profile.full_name ? profile.name : null;
  const clinicName = profile?.clinic_name || profile?.clinicName || profile?.clinic || legacyClinicName;
  return typeof clinicName === "string" ? clinicName.trim() : "";
};

const normalizeWorkDays = (workDays) =>
  Array.isArray(workDays) ? workDays.join(",") : workDays || null;

const nullable = (value) =>
  value === undefined || value === "" ? null : value;

// Helper to get ratings for a doc/staff
const getRatings = async ({ doctor_id, staff_id }) => {
  const matchField = doctor_id ? { doctor_id } : { staff_id };
  const agg = await Rating.aggregate([
    { $match: matchField },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  if (!agg.length) return { total_ratings: 0, average_rating: 0 };
  return {
    total_ratings: agg[0].total,
    average_rating: Math.round(agg[0].avg * 10) / 10,
  };
};

const formatGeoLocation = (doc) => {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  if (obj.geo_location && obj.geo_location.coordinates && obj.geo_location.coordinates.length === 2) {
    obj.geo_location = {
      latitude: obj.geo_location.coordinates[1],
      longitude: obj.geo_location.coordinates[0],
    };
  } else {
    obj.geo_location = null;
  }
  return obj;
};

const getDoctorProfileByUserId = async (userId) => {
  const doctor = await Doctor.findOne({ user_id: userId }).lean();
  if (!doctor) return null;
  const ratings = await getRatings({ doctor_id: doctor._id });
  return {
    doctor_id: doctor._id,
    full_name: doctor.full_name,
    gender: doctor.gender,
    phone: doctor.phone,
    specialist: doctor.specialist,
    work_days: doctor.work_days,
    work_from: doctor.work_from,
    work_to: doctor.work_to,
    consultation_price: doctor.consultation_price,
    location: doctor.location,
    geo_location: doctor.geo_location?.coordinates?.length === 2
      ? { latitude: doctor.geo_location.coordinates[1], longitude: doctor.geo_location.coordinates[0] }
      : null,
    years_of_experience: doctor.years_of_experience,
    bio: doctor.bio,
    is_verified: doctor.is_verified,
    licence: doctor.licence,
    ...ratings,
  };
};

const getStaffProfileByUserId = async (userId) => {
  const staff = await Staff.findOne({ user_id: userId }).populate("clinic_id", "name location geo_location").lean();
  if (!staff) return null;
  const ratings = await getRatings({ staff_id: staff._id });
  const clinic = staff.clinic_id;
  return {
    staff_id: staff._id,
    full_name: staff.full_name,
    phone: staff.phone,
    gender: staff.gender,
    years_of_experience: staff.years_of_experience,
    bio: staff.bio,
    specialist: staff.specialist,
    work_days: staff.work_days,
    work_from: staff.work_from,
    work_to: staff.work_to,
    consultation_price: staff.consultation_price,
    location: staff.location,
    geo_location: staff.geo_location?.coordinates?.length === 2
      ? { latitude: staff.geo_location.coordinates[1], longitude: staff.geo_location.coordinates[0] }
      : null,
    is_verified: staff.is_verified,
    clinic_id: clinic?._id || null,
    licence: staff.licence,
    clinic_name: clinic?.name || null,
    clinic_location: clinic?.location || null,
    clinic_geo_location: clinic?.geo_location?.coordinates?.length === 2
      ? { latitude: clinic.geo_location.coordinates[1], longitude: clinic.geo_location.coordinates[0] }
      : null,
    ...ratings,
  };
};

const buildGeoLocationField = (geo_location, fieldName) => {
  const normalized = normalizeGeoLocation(geo_location, fieldName);
  if (!normalized) return null;
  return { type: "Point", coordinates: [normalized.longitude, normalized.latitude] };
};

exports.signup = catchAsync(async (req, res, next) => {
  const { email, password, user_type, profile, photo } = req.body;

  const exists = await User.findOne({ email });
  if (exists) return next(new AppError("Email is already in use", 409));

  if (user_type === "clinic") {
    const clinicExists = await Clinic.findOne({
      $or: [{ name: profile.name }, { email: profile.email || email }],
    });
    if (clinicExists) return next(new AppError("Clinic name or email is already in use", 409));
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const accountPhoto = photo || profile?.photo || null;

  const session = await mongoose.startSession();
  session.startTransaction();

  let user;
  const roleIds = { patientid: null, doctorid: null, clinicid: null, staffid: null };

  try {
    const [newUser] = await User.create(
      [{ email, password: hashedPassword, user_type, photo: accountPhoto }],
      { session }
    );
    user = newUser;

    if (user_type === "patient") {
      const { date_of_birth, gender, phone } = profile;
      const full_name = getAccountName(profile);
      const [patient] = await Patient.create(
        [{ user_id: user._id, full_name, date_of_birth: date_of_birth || null, gender: gender || null, phone: phone || null }],
        { session }
      );
      roleIds.patientid = patient._id;
    }

    if (user_type === "doctor") {
      const { gender, phone, years_of_experience, bio, consultation_price, specialist, work_days, work_from, work_to, location, geo_location } = profile;
      const full_name = getAccountName(profile);
      const normalizedWorkDays = normalizeWorkDays(work_days);
      const geoField = geo_location ? buildGeoLocationField(geo_location, "profile.geo_location") : null;

      const [doctor] = await Doctor.create(
        [{
          user_id: user._id, full_name, gender: gender || null, phone: phone || null,
          years_of_experience: nullable(years_of_experience), bio: bio || null,
          consultation_price: nullable(consultation_price), specialist: specialist || null,
          work_days: normalizedWorkDays, work_from: work_from || null, work_to: work_to || null,
          location: location || null, geo_location: geoField,
        }],
        { session }
      );
      roleIds.doctorid = doctor._id;

      const admins = await Admin.find({}).select("user_id").session(session);
      for (const admin of admins) {
        await createNotification({
          user_id: admin.user_id,
          title: "طلب توثيق طبيب",
          message: `يوجد حساب طبيب جديد باسم "${full_name}" بانتظار التوثيق.`,
        });
      }
    }

    if (user_type === "clinic") {
      const { address, location, phone, email: clinic_email, geo_location } = profile;
      const name = getClinicName(profile);
      const geoField = geo_location ? buildGeoLocationField(geo_location, "profile.geo_location") : null;
      const contactEmail = clinic_email || email;

      const [clinic] = await Clinic.create(
        [{
          owner_user_id: user._id, name, address: address || null, location: location || null,
          phone: phone || null, email: contactEmail, status: "pending", geo_location: geoField,
        }],
        { session }
      );
      roleIds.clinicid = clinic._id;

      const admins = await Admin.find({}).select("user_id").session(session);
      for (const admin of admins) {
        await createNotification({
          user_id: admin.user_id,
          title: "طلب اعتماد عيادة",
          message: `تم إرسال طلب عيادة باسم "${name}" وهو بانتظار المراجعة.`,
        });
      }
    }

    if (user_type === "staff") {
      const { years_of_experience, location, gender, specialist, work_days, work_from, work_to, consultation_price, phone } = profile;
      const full_name = getAccountName(profile);
      const clinicName = getStaffClinicName(profile);
      const normalizedWorkDays = normalizeWorkDays(work_days);

      if (!clinicName) throw new AppError("Clinic name is required", 400);

      const clinic = await Clinic.findOne({ name: clinicName, status: "approved" }).session(session);
      if (!clinic) throw new AppError("Clinic not found or not approved", 400);

      const normalizedPrice = consultation_price === undefined || consultation_price === null || consultation_price === ""
        ? null : Number(consultation_price);

      if (normalizedPrice !== null && (Number.isNaN(normalizedPrice) || normalizedPrice < 0)) {
        throw new AppError("consultation_price must be a valid non-negative number", 400);
      }

      const [staff] = await Staff.create(
        [{
          user_id: user._id, clinic_id: clinic._id, full_name,
          phone: phone || null, specialist: specialist || null,
          work_days: normalizedWorkDays, work_from: work_from || null, work_to: work_to || null,
          consultation_price: normalizedPrice, is_verified: false,
        }],
        { session }
      );

      user.clinic_name = clinic.name;
      roleIds.clinicid = clinic._id;
      roleIds.staffid = staff._id;

      await createNotification({
        user_id: clinic.owner_user_id,
        title: "طلب توثيق موظف",
        message: `يوجد حساب موظف جديد باسم "${full_name}" بانتظار التوثيق.`,
      });
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
  session.endSession();

  if (user_type === "doctor") {
    await sendDoctorPendingVerificationEmail({ email, profile });
  } else {
    await sendSignupWelcomeEmail({ email, profile });
  }

  let signupProfile = null;
  if (user_type === "doctor") signupProfile = await getDoctorProfileByUserId(user._id);
  if (user_type === "staff") signupProfile = await getStaffProfileByUserId(user._id);

  const accessToken = signAccessToken({ user_id: user._id, role: user.user_type });
  const refreshToken = signRefreshToken({ user_id: user._id });

  req.user = user;

  sendAccessCookie(res, accessToken);
  sendRefreshCookie(res, refreshToken);

  res.status(201).json({
    status: "success",
    user: {
      user_id: user._id,
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

  const user = await User.findOne({ email, is_active: true }).lean();
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return next(new AppError("Incorrect email or password", 401));
  }

  let profile = null;

  if (user.user_type === "patient") {
    const patient = await Patient.findOne({ user_id: user._id }).lean();
    if (patient) {
      profile = {
        patient_id: patient._id,
        full_name: patient.full_name,
        date_of_birth: patient.date_of_birth ? new Date(patient.date_of_birth).toISOString().slice(0, 10) : null,
        gender: patient.gender,
        phone: patient.phone,
      };
    }
  }

  if (user.user_type === "doctor") {
    profile = await getDoctorProfileByUserId(user._id);
  }

  if (user.user_type === "staff") {
    profile = await getStaffProfileByUserId(user._id);
  }

  if (user.user_type === "clinic") {
    const clinic = await Clinic.findOne({ owner_user_id: user._id }).lean();
    if (clinic) {
      profile = {
        clinic_id: clinic._id,
        name: clinic.name,
        address: clinic.address,
        location: clinic.location,
        phone: clinic.phone,
        email: clinic.email,
        status: clinic.status,
        licence: clinic.licence,
        geo_location: clinic.geo_location?.coordinates?.length === 2
          ? { latitude: clinic.geo_location.coordinates[1], longitude: clinic.geo_location.coordinates[0] }
          : null,
      };
    }
  }

  if (user.user_type === "admin") {
    const admin = await Admin.findOne({ user_id: user._id }).lean();
    if (admin) profile = { admin_id: admin._id, full_name: admin.full_name };
  }

  const accessToken = signAccessToken({ user_id: user._id, role: user.user_type });
  const refreshToken = signRefreshToken({ user_id: user._id });

  req.user = user;

  sendAccessCookie(res, accessToken);
  sendRefreshCookie(res, refreshToken);

  res.status(200).json({
    status: "success",
    user: {
      user_id: user._id,
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

  const user = await User.findById(decoded.user_id).select("user_type is_active").lean();
  if (!user || !user.is_active) return next(new AppError("User not found", 401));

  const accessToken = signAccessToken({ user_id: user._id, role: user.user_type });
  sendAccessCookie(res, accessToken);

  res.status(200).json({ status: "success" });
});

exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email, is_active: true }).lean();
  const responseMessage =
    "If an active account exists for this email, a password reset code has been sent.";

  if (!user) {
    return res.status(200).json({ status: "success", message: responseMessage });
  }

  const otpDigits = getPasswordResetOtpDigits();
  const otpCode = generatePasswordResetOtp(otpDigits);
  const hashedOtpCode = hashPasswordResetOtp(otpCode);
  const expiresMinutes = getPasswordResetOtpExpiresMinutes();

  await User.findByIdAndUpdate(user._id, {
    password_reset_otp: hashedOtpCode,
    password_reset_otp_expires: new Date(Date.now() + expiresMinutes * 60 * 1000),
    password_reset_token: null,
    password_reset_expires: null,
  });

  try {
    await new Email({ email: user.email }).sendPasswordResetOtp({ otpCode, expiresMinutes });
  } catch (err) {
    await User.findByIdAndUpdate(user._id, {
      password_reset_otp: null,
      password_reset_otp_expires: null,
      password_reset_token: null,
      password_reset_expires: null,
    });
    return next(new AppError("Could not send password reset email. Please try again later.", 500));
  }

  res.status(200).json({ status: "success", message: responseMessage });
});

exports.verifyPasswordResetOtp = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;
  const hashedOtpCode = hashPasswordResetOtp(otp);

  const user = await User.findOne({
    email,
    password_reset_otp: hashedOtpCode,
    password_reset_otp_expires: { $gt: new Date() },
    is_active: true,
  }).lean();

  if (!user) return next(new AppError("Reset code is invalid or has expired", 400));

  const resetToken = crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("hex");
  const hashedResetToken = hashPasswordResetToken(resetToken);
  const expiresMinutes = getPasswordResetExpiresMinutes();

  await User.findByIdAndUpdate(user._id, {
    password_reset_token: hashedResetToken,
    password_reset_expires: new Date(Date.now() + expiresMinutes * 60 * 1000),
    password_reset_otp: null,
    password_reset_otp_expires: null,
  });

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

  const user = await User.findOne({
    password_reset_token: hashedResetToken,
    password_reset_expires: { $gt: new Date() },
    is_active: true,
  }).lean();

  if (!user) return next(new AppError("Password reset token is invalid or has expired", 400));

  const hashedPassword = await bcrypt.hash(password, 12);

  await User.findByIdAndUpdate(user._id, {
    password: hashedPassword,
    password_reset_token: null,
    password_reset_expires: null,
    password_reset_otp: null,
    password_reset_otp_expires: null,
  });

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
  res.status(200).json({ status: "success", message: "تم تسجيل الخروج بنجاح" });
};
