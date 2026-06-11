const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const mongoose = require("mongoose");

const Doctor = require("../models/Doctor.model");
const Clinic = require("../models/Clinic.model");
const Staff = require("../models/Staff.model");
const Booking = require("../models/Booking.model");
const Rating = require("../models/Rating.model");
const Patient = require("../models/Patient.model");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const parsePagination = (query) => {
  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
  return { page, limit, skip: (page - 1) * limit };
};

const parseRatingBody = (body) => {
  const rating = Number(body.rating);
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError("rating must be an integer between 1 and 5", 400);
  if (!comment) throw new AppError("comment is required", 400);
  if (comment.length > 500) throw new AppError("comment must not exceed 500 characters", 400);
  return { rating, comment };
};

const hasConfirmedDoctorBooking = async (patientUserId, doctorId) =>
  Booking.exists({ patient_user_id: patientUserId, doctor_id: doctorId, status: "confirmed" });

const hasConfirmedClinicBooking = async (patientUserId, clinicId) => {
  const staffIds = await Staff.find({ clinic_id: clinicId }).distinct("_id");
  return Booking.exists({ patient_user_id: patientUserId, staff_id: { $in: staffIds }, status: "confirmed" });
};

const hasConfirmedStaffBooking = async (patientUserId, staffId) =>
  Booking.exists({ patient_user_id: patientUserId, staff_id: staffId, status: "confirmed" });

const upsertRating = async ({ patient_user_id, doctor_id = null, clinic_id = null, staff_id = null, rating, comment }) => {
  const query = { patient_user_id };
  if (doctor_id) query.doctor_id = doctor_id;
  else if (clinic_id) query.clinic_id = clinic_id;
  else if (staff_id) query.staff_id = staff_id;

  const existing = await Rating.findOne(query).lean();
  if (existing) {
    const updated = await Rating.findByIdAndUpdate(existing._id, { rating, comment, updated_at: new Date() }, { new: true }).lean();
    return { action: "updated", rating_id: updated._id };
  }
  const created = await Rating.create({ patient_user_id, doctor_id, clinic_id, staff_id, rating, comment });
  return { action: "created", rating_id: created._id };
};

const getSummary = async (matchField) => {
  const agg = await Rating.aggregate([
    { $match: matchField },
    { $group: { _id: null, total_ratings: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  return {
    total_ratings: agg[0]?.total_ratings || 0,
    average_rating: Math.round((agg[0]?.avg || 0) * 10) / 10,
  };
};

exports.rateDoctor = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.doctorId);
  if (!doctorId) return next(new AppError("Invalid doctor id", 400));

  const doctor = await Doctor.findOne({ _id: doctorId, is_verified: true }).lean();
  if (!doctor) return next(new AppError("Doctor not found", 404));

  const { rating, comment } = parseRatingBody(req.body);
  const patient = await Patient.findOne({ user_id: req.user.user_id }).lean();
  if (!patient) return next(new AppError("Patient profile not found", 404));

  const booked = await hasConfirmedDoctorBooking(req.user.user_id, doctorId);
  if (!booked) return next(new AppError("You can rate only doctors you previously booked with", 403));

  const result = await upsertRating({ patient_user_id: req.user.user_id, doctor_id: doctorId, rating, comment });

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message: result.action === "created" ? "تم إنشاء تقييم الطبيب" : "تم تحديث تقييم الطبيب",
    rating: { rating_id: result.rating_id, doctor_id: doctorId, rating, comment },
  });
});

exports.rateClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.clinicId);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));

  const clinic = await Clinic.findOne({ _id: clinicId, status: "approved" }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));

  const { rating, comment } = parseRatingBody(req.body);

  const booked = await hasConfirmedClinicBooking(req.user.user_id, clinicId);
  if (!booked) return next(new AppError("You can rate only clinics you previously booked with", 403));

  const result = await upsertRating({ patient_user_id: req.user.user_id, clinic_id: clinicId, rating, comment });

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message: result.action === "created" ? "تم إنشاء تقييم العيادة" : "تم تحديث تقييم العيادة",
    rating: { rating_id: result.rating_id, clinic_id: clinicId, rating, comment },
  });
});

exports.rateStaff = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) return next(new AppError("Invalid staff id", 400));

  const staff = await Staff.findOne({ _id: staffId, is_verified: true }).lean();
  if (!staff) return next(new AppError("Staff member not found", 404));

  const { rating, comment } = parseRatingBody(req.body);

  const booked = await hasConfirmedStaffBooking(req.user.user_id, staffId);
  if (!booked) return next(new AppError("You can rate only staff you previously booked with", 403));

  const result = await upsertRating({ patient_user_id: req.user.user_id, staff_id: staffId, rating, comment });

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message: result.action === "created" ? "تم إنشاء تقييم الموظف" : "تم تحديث تقييم الموظف",
    rating: { rating_id: result.rating_id, staff_id: staffId, rating, comment },
  });
});

exports.getDoctorRatings = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.doctorId);
  if (!doctorId) return next(new AppError("Invalid doctor id", 400));

  const doctor = await Doctor.findOne({ _id: doctorId, is_verified: true }).lean();
  if (!doctor) return next(new AppError("Doctor not found", 404));

  const { page, limit, skip } = parsePagination(req.query);
  const summary = await getSummary({ doctor_id: new mongoose.Types.ObjectId(doctorId) });

  const ratings = await Rating.find({ doctor_id: doctorId })
    .populate("patient_user_id", "photo")
    .sort({ updated_at: -1, created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const patientIds = ratings.map((r) => r.patient_user_id?._id || r.patient_user_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map((p) => [String(p.user_id), p]));

  const result = ratings.map((r) => ({
    rating_id: r._id,
    rating: r.rating,
    comment: r.comment,
    patient_name: patientMap[String(r.patient_user_id?._id || r.patient_user_id)]?.full_name || null,
    patient_photo: r.patient_user_id?.photo || null,
  }));

  res.status(200).json({
    status: "success",
    summary,
    pagination: { page, limit, total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)) },
    results: result.length,
    ratings: result,
  });
});

exports.getClinicRatings = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.clinicId);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));

  const clinic = await Clinic.findOne({ _id: clinicId, status: "approved" }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));

  const { page, limit, skip } = parsePagination(req.query);
  const summary = await getSummary({ clinic_id: new mongoose.Types.ObjectId(clinicId) });

  const ratings = await Rating.find({ clinic_id: clinicId })
    .populate("patient_user_id", "photo")
    .sort({ updated_at: -1, created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const patientIds = ratings.map((r) => r.patient_user_id?._id || r.patient_user_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map((p) => [String(p.user_id), p]));

  const result = ratings.map((r) => ({
    rating_id: r._id,
    rating: r.rating,
    comment: r.comment,
    patient_name: patientMap[String(r.patient_user_id?._id || r.patient_user_id)]?.full_name || null,
    patient_photo: r.patient_user_id?.photo || null,
  }));

  res.status(200).json({
    status: "success",
    summary,
    pagination: { page, limit, total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)) },
    results: result.length,
    ratings: result,
  });
});

exports.getStaffRatings = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) return next(new AppError("Invalid staff id", 400));

  const staff = await Staff.findOne({ _id: staffId, is_verified: true }).lean();
  if (!staff) return next(new AppError("Staff member not found", 404));

  const { page, limit, skip } = parsePagination(req.query);
  const summary = await getSummary({ staff_id: new mongoose.Types.ObjectId(staffId) });

  const ratings = await Rating.find({ staff_id: staffId })
    .populate("patient_user_id", "photo")
    .sort({ updated_at: -1, created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const patientIds = ratings.map((r) => r.patient_user_id?._id || r.patient_user_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map((p) => [String(p.user_id), p]));

  const result = ratings.map((r) => ({
    rating_id: r._id,
    rating: r.rating,
    comment: r.comment,
    patient_name: patientMap[String(r.patient_user_id?._id || r.patient_user_id)]?.full_name || null,
    patient_photo: r.patient_user_id?.photo || null,
  }));

  res.status(200).json({
    status: "success",
    summary,
    pagination: { page, limit, total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)) },
    results: result.length,
    ratings: result,
  });
});
