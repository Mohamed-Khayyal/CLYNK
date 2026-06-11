const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");

const User = require("../models/User.model");
const Admin = require("../models/Admin.model");
const Doctor = require("../models/Doctor.model");
const Staff = require("../models/Staff.model");
const Clinic = require("../models/Clinic.model");
const Patient = require("../models/Patient.model");
const Booking = require("../models/Booking.model");
const Rating = require("../models/Rating.model");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

const getAdminUserId = (req, next) => {
  const adminUserId = req.user?.user_id;
  if (!adminUserId) { next(new AppError("Admin authentication is required", 401)); return null; }
  return adminUserId;
};

const getRatingsForEntity = async (matchField) => {
  const agg = await Rating.aggregate([
    { $match: matchField },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  if (!agg.length) return { total_ratings: 0, average_rating: 0 };
  return { total_ratings: agg[0].total, average_rating: Math.round(agg[0].avg * 10) / 10 };
};

exports.createAdmin = catchAsync(async (req, res, next) => {
  const { email, password, full_name, name } = req.body;
  const adminName = full_name || name;

  if (!email || !password || !adminName) return next(new AppError("Name, email, and password are required", 400));
  if (!EMAIL_REGEX.test(email)) return next(new AppError("Invalid email format", 400));

  const exists = await User.findOne({ email });
  if (exists) return next(new AppError("Email is already in use", 409));

  const hashedPassword = await bcrypt.hash(password, 12);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [newUser] = await User.create([{ email, password: hashedPassword, user_type: "admin" }], { session });
    await Admin.create([{ user_id: newUser._id, full_name: adminName }], { session });
    await session.commitTransaction();

    res.status(201).json({ status: "success", user: { user_id: newUser._id, email, role: "admin" } });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
  session.endSession();
});

exports.getAllAdmins = catchAsync(async (req, res) => {
  const admins = await Admin.find().populate("user_id", "email photo is_active created_at").sort({ _id: -1 }).lean();
  const result = admins.map((a) => ({
    admin_id: a._id,
    user_id: a.user_id?._id,
    email: a.user_id?.email,
    full_name: a.full_name,
    photo: a.user_id?.photo,
    is_active: a.user_id?.is_active,
    created_at: a.user_id?.created_at,
  }));
  res.status(200).json({ status: "success", results: result.length, admins: result });
});

const resolveUser = async (id) => {
  let user = await User.findById(id).lean();
  if (!user) {
    const entity = await Doctor.findById(id).lean() || 
                   await Clinic.findById(id).lean() || 
                   await Patient.findById(id).lean() || 
                   await Staff.findById(id).lean() ||
                   await Admin.findById(id).lean();
    if (entity && entity.user_id) {
      user = await User.findById(entity.user_id).lean();
    }
  }
  return user;
};

exports.deleteUser = catchAsync(async (req, res, next) => {
  const userId = parseId(req.params.id);
  if (!userId) return next(new AppError("Invalid user id", 400));

  const user = await resolveUser(userId);
  if (!user) return next(new AppError("User not found", 404));
  if (String(user._id) === String(req.user.user_id)) return next(new AppError("You cannot deactivate your own account", 400));
  if (!user.is_active) return next(new AppError("User is already inactive", 400));

  await User.findByIdAndUpdate(user._id, { is_active: false });
  res.status(200).json({ status: "success", message: "User deactivated successfully", user: { user_id: user._id, email: user.email, role: user.user_type, is_active: false } });
});

exports.undeleteUser = catchAsync(async (req, res, next) => {
  const userId = parseId(req.params.id);
  if (!userId) return next(new AppError("Invalid user id", 400));
  
  const user = await resolveUser(userId);
  if (!user) return next(new AppError("User not found", 404));
  if (user.is_active) return next(new AppError("User is already active", 400));

  await User.findByIdAndUpdate(user._id, { is_active: true });
  res.status(200).json({ status: "success", message: "User activated successfully", user: { user_id: user._id, email: user.email, role: user.user_type, is_active: true } });
});

const buildClinicList = async (filter) => {
  const clinics = await Clinic.find(filter).populate("owner_user_id", "email").sort({ _id: -1 }).lean();

  return Promise.all(clinics.map(async (c) => {
    const total_staff = await Staff.countDocuments({ clinic_id: c._id });
    const ratingData = await getRatingsForEntity({ clinic_id: c._id });
    return {
      _id: c._id,
      id: c._id,
      clinic_id: c._id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      location: c.location,
      status: c.status,
      created_at: c.created_at,
      licence: c.licence,
      owner_email: c.owner_user_id?.email,
      total_staff,
      ...ratingData,
    };
  }));
};

exports.getClinics = catchAsync(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const clinics = await buildClinicList(filter);
  res.status(200).json({ status: "success", results: clinics.length, clinics });
});

exports.getPendingClinics = catchAsync(async (req, res) => {
  const clinics = await buildClinicList({ status: "pending" });
  res.status(200).json({ status: "success", results: clinics.length, clinics });
});

exports.getApprovedClinics = catchAsync(async (req, res) => {
  const clinics = await buildClinicList({ status: "approved" });
  res.status(200).json({ status: "success", results: clinics.length, clinics });
});

exports.approveClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.id);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));
  const adminUserId = getAdminUserId(req, next);
  if (!adminUserId) return;

  const admin = await Admin.findOne({ user_id: adminUserId }).lean();
  if (!admin) return next(new AppError("Admin privileges are required", 403));

  let clinic = await Clinic.findById(clinicId).lean();
  if (!clinic) clinic = await Clinic.findOne({ user_id: clinicId }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));

  if (clinic.status === "approved") {
    return next(new AppError("Clinic is already approved", 400));
  }

  await Clinic.findByIdAndUpdate(clinic._id, { 
    status: "approved",
    verified_by_admin_id: admin._id,
    verified_at: new Date()
  });

  await createNotification({ user_id: clinic.owner_user_id, title: "تم اعتماد العيادة", message: "تم اعتماد عيادتك وأصبحت متاحة الآن." });

  res.status(200).json({ status: "success", message: "تم اعتماد العيادة بنجاح" });
});

exports.rejectClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.id);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));
  const adminUserId = getAdminUserId(req, next);
  if (!adminUserId) return;

  const admin = await Admin.findOne({ user_id: adminUserId }).lean();
  if (!admin) return next(new AppError("Admin privileges required", 403));

  let clinic = await Clinic.findById(clinicId).lean();
  if (!clinic) clinic = await Clinic.findOne({ user_id: clinicId }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));
  if (clinic.status !== "pending" && clinic.status !== "approved") return next(new AppError("Only pending or approved clinics can be rejected", 400));

  await Clinic.findByIdAndUpdate(clinic._id, { status: "rejected", verified_by_admin_id: null, verified_at: null });
  await createNotification({ user_id: clinic.owner_user_id, title: "تم رفض العيادة", message: "تم رفض طلب التحقق من العيادة، يرجى مراجعة البيانات وإعادة التقديم." });

  res.status(200).json({ status: "success", message: "Clinic rejected successfully" });
});

exports.unverifyClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.id);
  if (!clinicId) return next(new AppError("Invalid clinic id", 400));
  const adminUserId = getAdminUserId(req, next);
  if (!adminUserId) return;

  const admin = await Admin.findOne({ user_id: adminUserId }).lean();
  if (!admin) return next(new AppError("Admin privileges required", 403));

  let clinic = await Clinic.findById(clinicId).lean();
  if (!clinic) clinic = await Clinic.findOne({ user_id: clinicId }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));
  if (clinic.status !== "approved" && clinic.status !== "rejected") return next(new AppError("Only approved or rejected clinics can be unverified", 400));

  await Clinic.findByIdAndUpdate(clinic._id, { status: "pending", verified_by_admin_id: null, verified_at: null });
  await createNotification({ user_id: clinic.owner_user_id, title: "تم إلغاء التحقق من العيادة", message: "تم إلغاء اعتماد العيادة وعادت للمراجعة مرة أخرى." });

  res.status(200).json({ status: "success", message: "Clinic unverified successfully" });
});

const buildDoctorList = async (filter) => {
  const doctors = await Doctor.find(filter)
    .populate("user_id", "email photo is_active created_at")
    .sort({ _id: -1 })
    .lean();

  return Promise.all(doctors.map(async (d) => {
    const bookingAgg = await Booking.aggregate([
      { $match: { doctor_id: d._id, status: "confirmed" } },
      { $group: { _id: null, total: { $sum: 1 }, patients: { $addToSet: "$patient_user_id" } } },
    ]);
    const total_bookings = bookingAgg[0]?.total || 0;
    const total_patients = bookingAgg[0]?.patients?.length || 0;
    const ratings = await getRatingsForEntity({ doctor_id: d._id });

    return {
      _id: d._id,
      id: d._id,
      doctor_id: d._id,
      phone: d.phone,
      user_id: d.user_id?._id,
      email: d.user_id?.email,
      full_name: d.full_name,
      gender: d.gender,
      years_of_experience: d.years_of_experience,
      bio: d.bio,
      consultation_price: d.consultation_price,
      work_from: d.work_from,
      work_to: d.work_to,
      work_days: d.work_days,
      specialist: d.specialist,
      location: d.location,
      is_verified: d.is_verified,
      licence: d.licence,
      photo: d.user_id?.photo,
      is_active: d.user_id?.is_active,
      total_bookings,
      total_patients,
      ...ratings,
    };
  }));
};

exports.getAllDoctors = catchAsync(async (req, res) => {
  const doctors = await buildDoctorList({});
  res.status(200).json({ status: "success", results: doctors.length, doctors });
});

exports.getVerifiedDoctors = catchAsync(async (req, res) => {
  const doctors = await buildDoctorList({ is_verified: true });
  res.status(200).json({ status: "success", results: doctors.length, doctors });
});

exports.getUnverifiedDoctors = catchAsync(async (req, res) => {
  const doctors = await buildDoctorList({ is_verified: false });
  res.status(200).json({ status: "success", results: doctors.length, doctors });
});

exports.verifyDoctor = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.id);
  if (!doctorId) return next(new AppError("Invalid doctor id", 400));
  const adminUserId = getAdminUserId(req, next);
  if (!adminUserId) return;

  const admin = await Admin.findOne({ user_id: adminUserId }).lean();
  if (!admin) return next(new AppError("Admin privileges are required", 403));

  let doctor = await Doctor.findById(doctorId).lean();
  if (!doctor) doctor = await Doctor.findOne({ user_id: doctorId }).lean();
  if (!doctor) return next(new AppError("Doctor not found", 404));
  if (doctor.is_verified) return next(new AppError("Doctor is already verified", 400));

  await Doctor.findByIdAndUpdate(doctor._id, { is_verified: true });
  await createNotification({ user_id: doctor.user_id, title: "تم توثيق حساب الطبيب", message: "تم توثيق حسابك كطبيب. يمكنك الآن استقبال الحجوزات." });

  res.status(200).json({ status: "success", message: "تم توثيق الطبيب بنجاح" });
});

exports.unverifyDoctor = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.id);
  if (!doctorId) return next(new AppError("Invalid doctor id", 400));
  const adminUserId = getAdminUserId(req, next);
  if (!adminUserId) return;

  const admin = await Admin.findOne({ user_id: adminUserId }).lean();
  if (!admin) return next(new AppError("Admin privileges are required", 403));

  let doctor = await Doctor.findById(doctorId).lean();
  if (!doctor) doctor = await Doctor.findOne({ user_id: doctorId }).lean();
  if (!doctor) return next(new AppError("Doctor not found", 404));
  if (!doctor.is_verified) return next(new AppError("Doctor is already unverified", 400));

  await Doctor.findByIdAndUpdate(doctor._id, { is_verified: false });
  await createNotification({ user_id: doctor.user_id, title: "تم إلغاء توثيق حساب الطبيب", message: "تم إلغاء توثيق حسابك كطبيب. يرجى التواصل مع الدعم للمساعدة." });

  res.status(200).json({ status: "success", message: "تم إلغاء توثيق الطبيب بنجاح" });
});

const buildStaffList = async (filter) => {
  const staffList = await Staff.find(filter)
    .populate("user_id", "email photo is_active")
    .populate("clinic_id", "name status location owner_user_id")
    .sort({ _id: -1 })
    .lean();

  return staffList.map((s) => ({
    _id: s._id,
    id: s._id,
    staff_id: s._id,
    user_id: s.user_id?._id,
    email: s.user_id?.email,
    full_name: s.full_name,
    specialist: s.specialist,
    work_days: s.work_days,
    work_from: s.work_from,
    work_to: s.work_to,
    consultation_price: s.consultation_price,
    is_verified: s.is_verified,
    is_active: s.user_id?.is_active,
    photo: s.user_id?.photo,
    clinic_id: s.clinic_id?._id,
    clinic_name: s.clinic_id?.name,
    clinic_status: s.clinic_id?.status,
    clinic_location: s.clinic_id?.location,
    owner_user_id: s.clinic_id?.owner_user_id,
  }));
};

exports.getAllStaff = catchAsync(async (req, res) => {
  const staff = await buildStaffList({});
  res.status(200).json({ status: "success", results: staff.length, staff });
});

exports.getVerifiedStaff = catchAsync(async (req, res) => {
  const staff = await buildStaffList({ is_verified: true });
  res.status(200).json({ status: "success", results: staff.length, staff });
});

exports.getUnverifiedStaff = catchAsync(async (req, res) => {
  const staff = await buildStaffList({ is_verified: false });
  res.status(200).json({ status: "success", results: staff.length, staff });
});

exports.getAllPatients = catchAsync(async (req, res) => {
  const patients = await Patient.find()
    .populate("user_id", "email photo is_active")
    .sort({ _id: -1 })
    .lean();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const result = await Promise.all(patients.map(async (p) => {
    const bookings = await Booking.find({ patient_user_id: p.user_id._id }).lean();
    const total_bookings = bookings.length;
    const upcoming_bookings = bookings.filter((b) => b.booking_date >= todayStr).length;
    return {
      _id: p._id,
      id: p._id,
      patient_id: p._id,
      user_id: p.user_id?._id,
      email: p.user_id?.email,
      full_name: p.full_name,
      phone: p.phone,
      gender: p.gender,
      is_active: p.user_id?.is_active,
      photo: p.user_id?.photo,
      total_bookings,
      upcoming_bookings,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, patients: result });
});

exports.getAllBookings = catchAsync(async (req, res) => {
  const bookings = await Booking.find()
    .populate({ path: "patient_user_id", model: "User" })
    .populate({ path: "doctor_id", model: "Doctor", select: "full_name specialist" })
    .populate({ path: "staff_id", model: "Staff", select: "full_name specialist clinic_id" })
    .sort({ booking_date: -1, booking_from: -1 })
    .lean();

  const result = await Promise.all(bookings.map(async (b) => {
    let clinic_name = null;
    let clinic_id = null;
    if (b.staff_id?.clinic_id) {
      const clinic = await Clinic.findById(b.staff_id.clinic_id).select("name").lean();
      clinic_name = clinic?.name;
      clinic_id = clinic?._id;
    }
    const patient = await Patient.findOne({ user_id: b.patient_user_id?._id }).lean();
    return {
      booking_id: b._id,
      booking_date: b.booking_date,
      booking_from: b.booking_from,
      booking_to: b.booking_to,
      date_time: `${b.booking_date} ${b.booking_from}`,
      status: b.status,
      doctor_name: b.doctor_id?.full_name || b.staff_id?.full_name || null,
      session_type: b.staff_id ? "عيادة" : "طبيب",
      patient_id: patient?._id || null,
      patient_name: patient?.full_name || null,
      patient_number: patient?.phone || null,
      clinic_id,
      clinic_name,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, bookings: result });
});

exports.adminStats = catchAsync(async (req, res) => {
  const [totalDoctors, totalStaff, totalClinics, totalPatients] = await Promise.all([
    Doctor.countDocuments(),
    Staff.countDocuments(),
    Clinic.countDocuments(),
    Patient.countDocuments(),
  ]);

  res.status(200).json({
    status: "success",
    data: { totalDoctors, totalStaff, totalClinics, totalPatients, totalMedicalUsers: totalDoctors + totalStaff },
  });
});
