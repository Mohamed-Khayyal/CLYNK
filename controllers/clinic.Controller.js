const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");
const { normalizeGeoLocation } = require("../utilts/geo.Location");

const User = require("../models/User.model");
const Admin = require("../models/Admin.model");
const Clinic = require("../models/Clinic.model");
const Staff = require("../models/Staff.model");
const Booking = require("../models/Booking.model");
const Rating = require("../models/Rating.model");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

const parseLimit = (value, fallback = 5, max = 20) => {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) return fallback;
  return Math.min(limit, max);
};

const formatGeo = (geo_location) => {
  if (!geo_location || !geo_location.coordinates || geo_location.coordinates.length !== 2) return null;
  return { latitude: geo_location.coordinates[1], longitude: geo_location.coordinates[0] };
};

const getRatings = async (matchField) => {
  const agg = await Rating.aggregate([
    { $match: matchField },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  if (!agg.length) return { total_ratings: 0, average_rating: 0 };
  return { total_ratings: agg[0].total, average_rating: Math.round(agg[0].avg * 10) / 10 };
};

exports.createClinic = catchAsync(async (req, res, next) => {
  const { name, address, location, phone, email, password, photo, geo_location } = req.body;

  if (!name || !email || !password) return next(new AppError("Name, email, and password are required", 400));
  if (typeof password !== "string" || password.length < 8) return next(new AppError("Password must be at least 8 characters", 400));
  if (!EMAIL_REGEX.test(email)) return next(new AppError("Invalid email format", 400));

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser) return next(new AppError("Email is already in use", 409));

  const existingClinic = await Clinic.findOne({ $or: [{ name }, { email }] }).lean();
  if (existingClinic) return next(new AppError("Clinic name or email is already in use", 409));

  const hashedPassword = await bcrypt.hash(password, 12);
  const normalizedGeo = geo_location ? normalizeGeoLocation(geo_location) : null;
  const geoField = normalizedGeo ? { type: "Point", coordinates: [normalizedGeo.longitude, normalizedGeo.latitude] } : null;

  const session = await mongoose.startSession();
  session.startTransaction();
  let clinic;

  try {
    const [owner] = await User.create([{ email, password: hashedPassword, user_type: "clinic", photo: photo || null }], { session });
    const [newClinic] = await Clinic.create([{
      owner_user_id: owner._id, name, address: address || null, location: location || null,
      phone: phone || null, email, status: "pending", geo_location: geoField,
    }], { session });

    clinic = { clinic_id: newClinic._id, status: newClinic.status, owner_user_id: owner._id, email: owner.email, photo: owner.photo, geo_location: normalizedGeo || null };

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
  session.endSession();

  const admins = await Admin.find().select("user_id").lean();
  for (const admin of admins) {
    await createNotification({ user_id: admin.user_id, title: "طلب اعتماد عيادة", message: `تم إرسال طلب عيادة باسم "${name}" وهو بانتظار المراجعة.` });
  }

  res.status(201).json({ status: "success", clinic, message: "تم إنشاء العيادة وبانتظار اعتماد المشرف" });
});

exports.getPublicClinics = catchAsync(async (req, res) => {
  const clinics = await Clinic.find({ status: "approved" })
    .populate("owner_user_id", "photo is_active")
    .sort({ created_at: -1 })
    .lean();

  const active = clinics.filter((c) => c.owner_user_id?.is_active);

  const result = await Promise.all(active.map(async (c) => {
    const doctors_count = await Staff.countDocuments({
      clinic_id: c._id,
      work_days: { $ne: null },
      work_from: { $ne: null },
      work_to: { $ne: null },
      is_verified: true,
    });
    const ratings = await getRatings({ clinic_id: c._id });
    return {
      clinic_id: c._id,
      name: c.name,
      location: c.location,
      geo_location: formatGeo(c.geo_location),
      phone: c.phone,
      photo: c.owner_user_id?.photo,
      doctors_count,
      ...ratings,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, clinics: result });
});

exports.getBestClinics = catchAsync(async (req, res) => {
  const limit = parseLimit(req.query.limit);

  const clinics = await Clinic.find({ status: "approved" })
    .populate("owner_user_id", "photo is_active")
    .lean();

  const active = clinics.filter((c) => c.owner_user_id?.is_active);

  const withStats = await Promise.all(active.map(async (c) => {
    const staffList = await Staff.find({ clinic_id: c._id }).lean();
    const staffIds = staffList.map((s) => s._id);
    const total_bookings = await Booking.countDocuments({ staff_id: { $in: staffIds }, status: "confirmed" });
    const ratings = await getRatings({ clinic_id: c._id });
    return {
      clinic_id: c._id,
      name: c.name,
      location: c.location,
      geo_location: formatGeo(c.geo_location),
      phone: c.phone,
      photo: c.owner_user_id?.photo,
      total_bookings,
      ...ratings,
    };
  }));

  withStats.sort((a, b) => b.average_rating - a.average_rating || b.total_bookings - a.total_bookings || b.total_ratings - a.total_ratings);

  res.status(200).json({ status: "success", results: withStats.slice(0, limit).length, clinics: withStats.slice(0, limit) });
});

exports.getActiveClinicStaff = catchAsync(async (req, res, next) => {
  const clinicId = req.params.clinicId;
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));

  const staffList = await Staff.find({ clinic_id: clinicId, is_verified: true })
    .populate("user_id", "photo is_active")
    .sort({ full_name: 1 })
    .lean();

  const active = staffList.filter((s) => s.user_id?.is_active);

  const result = active.map((s) => ({
    staff_id: s._id,
    full_name: s.full_name,
    specialist: s.specialist,
    work_days: s.work_days,
    work_from: s.work_from,
    work_to: s.work_to,
    consultation_price: s.consultation_price,
    photo: s.user_id?.photo,
    can_be_booked: Boolean(s.work_days && s.work_from && s.work_to),
  }));

  res.status(200).json({ status: "success", results: result.length, staff: result });
});

exports.getClinicProfile = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.id);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));

  const clinic = await Clinic.findOne({ _id: clinicId, status: "approved" })
    .populate("owner_user_id", "photo is_active")
    .lean();

  if (!clinic || !clinic.owner_user_id?.is_active) return next(new AppError("Clinic not found", 404));

  const ratings = await getRatings({ clinic_id: clinic._id });

  const staffList = await Staff.find({
    clinic_id: clinicId,
    work_days: { $ne: null },
    work_from: { $ne: null },
    work_to: { $ne: null },
    is_verified: true,
  }).populate("user_id", "photo").lean();

  const doctors = await Promise.all(staffList.map(async (s) => {
    const staffRatings = await getRatings({ staff_id: s._id });
    return {
      staff_id: s._id,
      full_name: s.full_name,
      specialist: s.specialist,
      work_days: s.work_days,
      years_of_experience: s.years_of_experience,
      work_from: s.work_from,
      work_to: s.work_to,
      consultation_price: s.consultation_price,
      photo: s.user_id?.photo,
      ...staffRatings,
    };
  }));

  res.status(200).json({
    status: "success",
    clinic: {
      clinic_id: clinic._id,
      name: clinic.name,
      location: clinic.location,
      geo_location: formatGeo(clinic.geo_location),
      phone: clinic.phone,
      photo: clinic.owner_user_id?.photo,
      ...ratings,
    },
    doctors,
  });
});

exports.getClinicStats = catchAsync(async (req, res) => {
  const clinic_id = req.clinic.clinic_id;

  const staffList = await Staff.find({ clinic_id }).lean();
  const staffIds = staffList.map((s) => s._id);

  const bookings = await Booking.find({ staff_id: { $in: staffIds }, status: "confirmed" }).lean();
  const todayStr = new Date().toISOString().slice(0, 10);

  const total_bookings = bookings.length;
  const today_bookings = bookings.filter((b) => b.booking_date === todayStr).length;
  const uniquePatients = new Set(bookings.map((b) => String(b.patient_user_id)));
  const total_patients = uniquePatients.size;

  const total_doctors = await Staff.countDocuments({
    clinic_id,
    work_days: { $ne: null },
    work_from: { $ne: null },
    work_to: { $ne: null },
    is_verified: true,
  });

  const ratings = await getRatings({ clinic_id });

  res.status(200).json({
    status: "success",
    stats: { total_bookings, today_bookings, total_patients, total_doctors, ...ratings },
  });
});
