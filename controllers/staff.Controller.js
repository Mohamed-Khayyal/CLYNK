const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");
const Email = require("../utilts/email");

const User = require("../models/User.model");
const Clinic = require("../models/Clinic.model");
const Staff = require("../models/Staff.model");

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const sendStaffDoctorPendingVerificationEmail = async ({ email, full_name }) => {
  try {
    await new Email({ email, name: full_name || email }).sendDoctorPendingVerification();
  } catch (err) {
    console.error("Failed to send staff doctor pending verification email:", err.message);
  }
};

exports.createStaffForClinic = catchAsync(async (req, res, next) => {
  const { email, password, full_name, name, phone, specialist, work_days, work_from, work_to, consultation_price } = req.body;
  const { clinic_id, owner_user_id } = req.clinic;
  const staffName = full_name || name;

  if (!email || !password || !staffName) return next(new AppError("Name, email, and password are required", 400));

  const exists = await User.findOne({ email }).lean();
  if (exists) return next(new AppError("Email is already in use", 409));

  const normalizedWorkDays = Array.isArray(work_days) ? work_days.join(",") : work_days || null;
  const normalizedPrice = consultation_price === undefined || consultation_price === null || consultation_price === "" ? null : Number(consultation_price);

  if ((work_from && !TIME_REGEX.test(work_from)) || (work_to && !TIME_REGEX.test(work_to))) return next(new AppError("Invalid work time format", 400));
  if (normalizedPrice !== null && (Number.isNaN(normalizedPrice) || normalizedPrice < 0)) return next(new AppError("consultation_price must be a valid non-negative number", 400));

  const hashedPassword = await bcrypt.hash(password, 12);

  const session = await mongoose.startSession();
  session.startTransaction();
  let userId;

  try {
    const [newUser] = await User.create([{ email, password: hashedPassword, user_type: "staff" }], { session });
    userId = newUser._id;
    await Staff.create([{
      user_id: userId, clinic_id, full_name: staffName,
      phone: phone || null, specialist: specialist || null,
      work_days: normalizedWorkDays, work_from: work_from || null, work_to: work_to || null,
      consultation_price: normalizedPrice, is_verified: false,
    }], { session });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
  session.endSession();

  if (owner_user_id) {
    await createNotification({ user_id: owner_user_id, title: "توثيق الموظف قيد الانتظار", message: `تم إنشاء حساب موظف باسم "${staffName}" وهو بانتظار التوثيق.` });
  }

  const hasDoctorProfile = Boolean(specialist || normalizedWorkDays || work_from || work_to || normalizedPrice !== null);
  if (hasDoctorProfile) await sendStaffDoctorPendingVerificationEmail({ email, full_name: staffName });

  res.status(201).json({
    status: "success",
    staff: {
      user_id: userId, email, full_name: staffName, phone: phone || null, specialist: specialist || null,
      work_days: normalizedWorkDays, work_from: work_from || null, work_to: work_to || null,
      consultation_price: normalizedPrice, clinic_id, is_verified: false,
    },
  });
});

exports.getMyClinicStaff = catchAsync(async (req, res) => {
  const { clinic_id } = req.clinic;

  const staffList = await Staff.find({ clinic_id })
    .populate("user_id", "email photo is_active")
    .sort({ _id: -1 })
    .lean();

  const result = staffList.map((s) => ({
    staff_id: s._id,
    email: s.user_id?.email,
    full_name: s.full_name,
    specialist: s.specialist,
    is_verified: s.is_verified,
    is_active: s.user_id?.is_active,
    photo: s.user_id?.photo,
    consultation_price: s.consultation_price,
  }));

  res.status(200).json({ status: "success", results: result.length, staff: result });
});

exports.verifyStaff = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) return next(new AppError("Invalid staff id", 400));
  const clinicId = req.clinic.clinic_id;

  const staff = await Staff.findOne({ _id: staffId, clinic_id: clinicId });
  if (!staff) return next(new AppError("Staff member not found in your clinic", 404));

  if (staff.is_verified) {
    return next(new AppError("Staff member is already verified", 400));
  }

  await Staff.findByIdAndUpdate(staffId, { is_verified: true });
  await createNotification({ user_id: staff.user_id, title: "تم توثيق حسابك في العيادة", message: `تم توثيقك من قِبل عيادة وأصبح بإمكانك الآن استقبال الحجوزات.` });

  res.status(200).json({ status: "success", message: "Staff member has been verified successfully" });
});

exports.UnVerifyStaff = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) return next(new AppError("Invalid staff id", 400));
  const clinic_id = req.clinic.clinic_id;

  const staff = await Staff.findOne({ _id: staffId, clinic_id }).lean();
  if (!staff) return next(new AppError("Staff member is not part of your clinic", 404));
  if (!staff.is_verified) return next(new AppError("Staff member is already unverified", 400));

  await Staff.findByIdAndUpdate(staffId, { is_verified: false });

  await createNotification({ user_id: staff.user_id, title: "تم إلغاء توثيق حساب الموظف", message: "تم إلغاء توثيق حسابك كموظف. يمكنك الآن الوصول إلى ميزات العيادة." });

  res.status(200).json({ status: "success", message: "Staff member unverified successfully", staff_id: staffId });
});

exports.getPendingStaff = catchAsync(async (req, res) => {
  const { clinic_id } = req.clinic;

  const staffList = await Staff.find({ clinic_id, is_verified: false })
    .populate("user_id", "email photo created_at")
    .sort({ _id: -1 })
    .lean();

  const result = staffList.map((s) => ({
    staff_id: s._id,
    full_name: s.full_name,
    specialist: s.specialist,
    email: s.user_id?.email,
    photo: s.user_id?.photo,
    created_at: s.user_id?.created_at,
  }));

  res.status(200).json({ status: "success", results: result.length, staff: result });
});

exports.getStaffProfile = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.id);
  if (!staffId) return next(new AppError("Invalid staff id", 400));
  if (!staffId || !mongoose.Types.ObjectId.isValid(staffId)) return next(new AppError("Invalid staff id", 400));

  const staff = await Staff.findOne({
    _id: staffId,
    is_verified: true,
  })
    .populate("user_id", "photo is_active")
    .populate("clinic_id", "name location phone status geo_location")
    .lean();

  if (!staff || !staff.user_id?.is_active || staff.clinic_id?.status !== "approved") {
    return next(new AppError("Staff member not found", 404));
  }

  const Rating = require("../models/Rating.model");
  const staffRatings = await Rating.aggregate([
    { $match: { staff_id: staff._id } },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  const clinicRatings = await Rating.aggregate([
    { $match: { clinic_id: staff.clinic_id?._id } },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);

  res.status(200).json({
    status: "success",
    staff: {
      staff_id: staff._id,
      user_id: staff.user_id?._id,
      full_name: staff.full_name,
      bio: staff.bio,
      phone: staff.phone,
      gender: staff.gender,
      specialist: staff.specialist,
      work_days: staff.work_days,
      work_from: staff.work_from,
      work_to: staff.work_to,
      consultation_price: staff.consultation_price,
      is_verified: staff.is_verified,
      photo: staff.user_id?.photo,
      clinic_id: staff.clinic_id?._id,
      clinic_name: staff.clinic_id?.name,
      clinic_location: staff.clinic_id?.location,
      clinic_phone: staff.clinic_id?.phone,
      total_bookings: 0,
      total_patients: 0,
      total_ratings: staffRatings[0]?.total || 0,
      average_rating: Math.round((staffRatings[0]?.avg || 0) * 10) / 10,
      clinic_total_ratings: clinicRatings[0]?.total || 0,
      clinic_average_rating: Math.round((clinicRatings[0]?.avg || 0) * 10) / 10,
      can_be_booked: true,
    },
  });
});
