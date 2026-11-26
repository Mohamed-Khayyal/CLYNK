const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const mongoose = require("mongoose");
const { createNotification } = require("../utilts/notification");

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

const RATEABLE_BOOKING_STATUSES = ["pending", "confirmed", "completed"];

const hasConfirmedDoctorBooking = async (patientUserId, doctorId) =>
  Booking.exists({ patient_user_id: patientUserId, doctor_id: doctorId, status: { $in: RATEABLE_BOOKING_STATUSES } });

const hasConfirmedClinicBooking = async (patientUserId, clinicId) => {
  const staffIds = await Staff.find({ clinic_id: clinicId }).distinct("_id");
  return Booking.exists({ patient_user_id: patientUserId, staff_id: { $in: staffIds }, status: { $in: RATEABLE_BOOKING_STATUSES } });
};

const hasConfirmedStaffBooking = async (patientUserId, staffId) =>
  Booking.exists({ patient_user_id: patientUserId, staff_id: staffId, status: { $in: RATEABLE_BOOKING_STATUSES } });

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

const rateProvider = async ({ req, res, next, targetId, forceType = null }) => {
  const id = parseId(targetId);
  if (!id) return next(new AppError(forceType === "staff" ? "Invalid staff id" : "Invalid doctor id", 400));

  let isStaff = forceType === "staff";
  let provider = null;

  if (forceType !== "staff") {
    provider = await Doctor.findOne({ _id: id, is_verified: true }).lean();
  }
  if (!provider && forceType !== "doctor") {
    const staff = await Staff.findOne({ _id: id, is_verified: true }).lean();
    if (staff) {
      provider = staff;
      isStaff = true;
    }
  }

  if (!provider) {
    return next(new AppError(forceType === "staff" ? "Staff member not found" : "Doctor not found", 404));
  }

  const { rating, comment } = parseRatingBody(req.body);
  const patient = await Patient.findOne({ user_id: req.user.user_id }).lean();
  if (!patient && !isStaff) return next(new AppError("Patient profile not found", 404));

  const booked = isStaff
    ? await hasConfirmedStaffBooking(req.user.user_id, id)
    : await hasConfirmedDoctorBooking(req.user.user_id, id);

  if (!booked) {
    const isArabic = String(req.headers["accept-language"] || "").toLowerCase().includes("ar");
    return next(
      new AppError(
        isArabic
          ? "يمكنك تقييم الطبيب الذي حجزت معه مسبقاً فقط"
          : "You can rate only doctors you previously booked with",
        403
      )
    );
  }

  const result = await upsertRating({
    patient_user_id: req.user.user_id,
    ...(isStaff ? { staff_id: id } : { doctor_id: id }),
    rating,
    comment,
  });

  if (result.action === "created") {
    const raterName = patient?.full_name || "أحد المرضى";
    createNotification({
      user_id: provider.user_id,
      title: "تقييم جديد",
      message: `قام ${raterName} بتقييمك بـ ${rating} نجوم وكتب: "${comment.slice(0, 80)}${comment.length > 80 ? '...' : ''}".`,
    }).catch(() => {});
  }

  const label = "الطبيب";
  const idField = isStaff ? { staff_id: id } : { doctor_id: id };

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message: result.action === "created" ? `تم إنشاء تقييم ${label}` : `تم تحديث تقييم ${label}`,
    rating: { rating_id: result.rating_id, ...idField, rating, comment },
  });
};

const getProviderRatings = async ({ req, res, next, targetId, forceType = null }) => {
  const id = parseId(targetId);
  if (!id) return next(new AppError(forceType === "staff" ? "Invalid staff id" : "Invalid doctor id", 400));

  let isStaff = forceType === "staff";
  let provider = null;

  if (forceType !== "staff") {
    provider = await Doctor.findOne({ _id: id, is_verified: true }).lean();
  }
  if (!provider && forceType !== "doctor") {
    const staff = await Staff.findOne({ _id: id, is_verified: true }).lean();
    if (staff) {
      provider = staff;
      isStaff = true;
    }
  }

  if (!provider) {
    return next(new AppError(forceType === "staff" ? "Staff member not found" : "Doctor not found", 404));
  }

  const { page, limit, skip } = parsePagination(req.query);
  const matchField = isStaff
    ? { staff_id: new mongoose.Types.ObjectId(id) }
    : { doctor_id: new mongoose.Types.ObjectId(id) };
  const findField = isStaff ? { staff_id: id } : { doctor_id: id };

  const summary = await getSummary(matchField);

  const ratings = await Rating.find(findField)
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
};

exports.rateDoctor = catchAsync(async (req, res, next) =>
  rateProvider({ req, res, next, targetId: req.params.doctorId })
);

exports.rateClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.clinicId);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));

  const clinic = await Clinic.findOne({ _id: clinicId, status: "approved" }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));

  const { rating, comment } = parseRatingBody(req.body);

  const booked = await hasConfirmedClinicBooking(req.user.user_id, clinicId);
  if (!booked) return next(new AppError("يمكنك تقييم العيادة التي حجزت معها مسبقاً فقط", 403));

  const result = await upsertRating({ patient_user_id: req.user.user_id, clinic_id: clinicId, rating, comment });

  // Notify the clinic owner on new rating
  if (result.action === "created") {
    createNotification({
      user_id: clinic.owner_user_id,
      title: "تقييم جديد للعيادة",
      message: `حصلت عيادتك على تقييم جديد بـ ${rating} نجوم من أحد المرضى.`,
    }).catch(() => {});
  }

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message: result.action === "created" ? "تم إنشاء تقييم العيادة" : "تم تحديث تقييم العيادة",
    rating: { rating_id: result.rating_id, clinic_id: clinicId, rating, comment },
  });
});

exports.rateStaff = catchAsync(async (req, res, next) =>
  rateProvider({ req, res, next, targetId: req.params.staffId, forceType: "staff" })
);

exports.getDoctorRatings = catchAsync(async (req, res, next) =>
  getProviderRatings({ req, res, next, targetId: req.params.doctorId })
);

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

exports.getStaffRatings = catchAsync(async (req, res, next) =>
  getProviderRatings({ req, res, next, targetId: req.params.staffId, forceType: "staff" })
);
