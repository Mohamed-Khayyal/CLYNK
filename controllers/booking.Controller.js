const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const generateSlots = require("../utilts/generate.Slots");
const { createNotification } = require("../utilts/notification");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

const User = require("../models/User.model");
const Doctor = require("../models/Doctor.model");
const Staff = require("../models/Staff.model");
const Patient = require("../models/Patient.model");
const Clinic = require("../models/Clinic.model");
const Booking = require("../models/Booking.model");
const mongoose = require("mongoose");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

const validateBookingTime = (booking_date, booking_from) => {
  if (!booking_date || !booking_from) throw new AppError("booking_date and booking_from are required", 400);
  if (!DATE_REGEX.test(booking_date)) throw new AppError("booking_date must be in YYYY-MM-DD format", 400);

  const [year, month, day] = booking_date.split("-").map(Number);
  const date = new Date(`${booking_date}T00:00:00`);
  if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new AppError("Invalid booking_date", 400);
  }

  if (!TIME_REGEX.test(booking_from)) throw new AppError("booking_from must be in HH:mm format", 400);

  const start = new Date(`${booking_date}T${booking_from}:00`);
  if (isNaN(start.getTime()) || start < new Date()) throw new AppError("Invalid booking time", 400);

  return new Date(start.getTime() + 30 * 60 * 1000).toTimeString().slice(0, 5);
};

const buildGuestEmail = () => {
  const token = crypto.randomBytes(6).toString("hex");
  return `guest+${Date.now()}-${token}@clynk.local`;
};

const createGuestPatient = async ({ patient_name, patient_phone }) => {
  const guestEmail = buildGuestEmail();
  const rawPassword = crypto.randomBytes(24).toString("hex");
  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [user] = await User.create([{ email: guestEmail, password: hashedPassword, user_type: "patient" }], { session });
    const [patient] = await Patient.create([{ user_id: user._id, full_name: patient_name, phone: patient_phone || null }], { session });
    await session.commitTransaction();
    return { patient_id: patient._id, patient_user_id: user._id, full_name: patient_name, phone: patient_phone || null };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
  session.endSession();
};

const getBookingTarget = async ({ doctor_id, staff_id }) => {
  if (doctor_id) {
    const doctor = await Doctor.findById(doctor_id).populate("user_id", "is_active").lean();
    if (!doctor || !doctor.is_verified || !doctor.user_id?.is_active) throw new AppError("Doctor is not available", 404);
    return { _id: doctor._id, user_id: doctor.user_id._id, full_name: doctor.full_name, work_days: doctor.work_days, work_from: doctor.work_from, work_to: doctor.work_to, isDoctor: true };
  }

  const staff = await Staff.findById(staff_id)
    .populate("user_id", "is_active")
    .populate("clinic_id", "status")
    .lean();

  if (!staff || !staff.work_days || !staff.work_from || !staff.work_to || !staff.is_verified || !staff.user_id?.is_active || staff.clinic_id?.status !== "approved") {
    throw new AppError("Doctor is not available", 404);
  }

  return { _id: staff._id, user_id: staff.user_id._id, full_name: staff.full_name, work_days: staff.work_days, work_from: staff.work_from, work_to: staff.work_to, isDoctor: false };
};

const assertSlotAvailable = async ({ target, doctor_id, staff_id, booking_date, booking_from, booking_to }) => {
  const day = new Date(booking_date).toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const allowedDays = (target.work_days || "").split(",").map((d) => d.trim().toLowerCase());
  if (!allowedDays.includes(day)) throw new AppError("Doctor does not work on this day", 400);
  if (booking_from < target.work_from || booking_to > target.work_to) throw new AppError("Invalid booking time", 400);

  const matchField = doctor_id ? { doctor_id } : { staff_id };
  const overlap = await Booking.findOne({
    ...matchField,
    booking_date,
    status: "confirmed",
    $and: [{ booking_from: { $lt: booking_to } }, { booking_to: { $gt: booking_from } }],
  }).lean();

  if (overlap) throw new AppError("This time slot is already booked", 409);
};

const assertPatientAvailability = async ({ patient_user_id, booking_date, booking_from, booking_to, doctor_id, staff_id }) => {
  const timeConflict = await Booking.findOne({
    patient_user_id,
    booking_date,
    status: "confirmed",
    $and: [{ booking_from: { $lt: booking_to } }, { booking_to: { $gt: booking_from } }],
  }).lean();

  if (timeConflict) throw new AppError("Patient already has a booking at this time", 409);

  const dayMatchField = doctor_id ? { doctor_id } : { staff_id };
  const dayConflict = await Booking.findOne({ patient_user_id, ...dayMatchField, booking_date, status: "confirmed" }).lean();
  if (dayConflict) throw new AppError("Patient already has a booking with this doctor today", 409);
};

const insertBooking = async ({ patient_user_id, doctor_id, staff_id, booking_date, booking_from, booking_to }) => {
  const booking = await Booking.create({
    patient_user_id,
    doctor_id: doctor_id || null,
    staff_id: staff_id || null,
    booking_date,
    booking_from,
    booking_to,
    prescription_access_status: "accepted",
    prescription_access_responded_at: new Date(),
  });
  return { booking_id: booking._id, prescription_access_status: "accepted" };
};

const createBookingRecord = async ({ patient_user_id, doctor_id, staff_id, booking_date, booking_from }) => {
  if ((!doctor_id && !staff_id) || (doctor_id && staff_id)) throw new AppError("Booking must target either a doctor or a staff member", 400);

  const booking_to = validateBookingTime(booking_date, booking_from);

  await assertPatientAvailability({ patient_user_id, booking_date, booking_from, booking_to, doctor_id, staff_id });

  const target = await getBookingTarget({ doctor_id, staff_id });

  await assertSlotAvailable({ target, doctor_id, staff_id, booking_date, booking_from, booking_to });

  const booking = await insertBooking({ patient_user_id, doctor_id, staff_id, booking_date, booking_from, booking_to });

  return { ...booking, booking_to, target };
};

const findPatientByName = async ({ patient_name, patient_phone, createIfMissing = false }) => {
  const patientName = typeof patient_name === "string" ? patient_name.trim() : "";
  const patientPhone = typeof patient_phone === "string" ? patient_phone.trim() : "";

  if (!patientName) throw new AppError("patient_name is required", 400);

  const query = { full_name: patientName };
  if (patientPhone) query.phone = patientPhone;

  const patients = await Patient.find(query).populate("user_id", "is_active").limit(2).lean();
  const activePatients = patients.filter((p) => p.user_id?.is_active);

  if (!activePatients.length) {
    if (!createIfMissing) throw new AppError("Patient not found", 404);
    return createGuestPatient({ patient_name: patientName, patient_phone: patientPhone || null });
  }

  if (activePatients.length > 1) throw new AppError("More than one patient matches this name. Add patient_phone to choose the patient.", 409);

  return { patient_id: activePatients[0]._id, patient_user_id: activePatients[0].user_id._id, full_name: activePatients[0].full_name, phone: activePatients[0].phone };
};

const getProviderTargetForUser = async ({ user, staff_id }) => {
  if (user.user_type === "doctor") {
    const doctor = await Doctor.findOne({ user_id: user.user_id, is_verified: true }).lean();
    if (!doctor) throw new AppError("Doctor profile not found or not verified", 404);
    return { doctor_id: doctor._id, staff_id: null };
  }

  const staff = await Staff.findOne({ user_id: user.user_id, is_verified: true }).lean();
  if (!staff) throw new AppError("Staff profile not found or not verified", 404);

  const staffHasSchedule = Boolean(staff.work_days && staff.work_from && staff.work_to);

  if (!staff_id && staffHasSchedule) return { doctor_id: null, staff_id: staff._id };
  if (!staff_id) throw new AppError("staff_id is required for non-doctor staff bookings", 400);

  const staffDoctor = await Staff.findOne({
    _id: staff_id,
    clinic_id: staff.clinic_id,
    work_days: { $ne: null },
    work_from: { $ne: null },
    work_to: { $ne: null },
    is_verified: true,
  }).populate("user_id", "is_active").populate("clinic_id", "status").lean();

  if (!staffDoctor || !staffDoctor.user_id?.is_active || staffDoctor.clinic_id?.status !== "approved") {
    throw new AppError("Staff member is not available in your clinic", 404);
  }

  return { doctor_id: null, staff_id: staffDoctor._id };
};

exports.createBooking = catchAsync(async (req, res) => {
  const { booking_date, booking_from } = req.body;
  const doctor_id = req.body.doctor_id || null;
  const staff_id = req.body.staff_id || null;
  const patient_user_id = req.user.user_id;

  const booking = await createBookingRecord({ patient_user_id, doctor_id, staff_id, booking_date, booking_from });

  await createNotification({
    user_id: booking.target.user_id,
    title: "حجز جديد",
    message: `تم جدولة حجز جديد بتاريخ ${booking_date} من ${booking_from} حتى ${booking.booking_to}.`,
  });

  // Notify the patient too
  await createNotification({
    user_id: patient_user_id,
    title: "تم تأكيد حجزك",
    message: `تم تأكيد حجزك مع ${booking.target.full_name} بتاريخ ${booking_date} من ${booking_from} حتى ${booking.booking_to}.`,
  });

  res.status(201).json({ status: "success", booking_id: booking.booking_id, prescription_access_status: booking.prescription_access_status });
});

exports.createProviderBooking = catchAsync(async (req, res) => {
  const { patient_name, patient_phone, booking_date } = req.body;
  const booking_from = req.body.booking_from || req.body.slot_from || req.body.slot?.from;
  const requestedStaffId = req.body.staff_id || null;

  const patient = await findPatientByName({ patient_name, patient_phone, createIfMissing: true });
  const { doctor_id, staff_id } = await getProviderTargetForUser({ user: req.user, staff_id: requestedStaffId });

  const booking = await createBookingRecord({ patient_user_id: patient.patient_user_id, doctor_id, staff_id, booking_date, booking_from });

  await createNotification({
    user_id: patient.patient_user_id,
    title: "تم إنشاء حجز لك",
    message: `قام ${booking.target.full_name} بجدولة حجز لك بتاريخ ${booking_date} من ${booking_from} حتى ${booking.booking_to}.`,
  });

  res.status(201).json({
    status: "success",
    booking: {
      booking_id: booking.booking_id,
      patient: { patient_id: patient.patient_id, patient_user_id: patient.patient_user_id, full_name: patient.full_name, phone: patient.phone },
      doctor_id,
      staff_id,
      booking_date,
      booking_from,
      booking_to: booking.booking_to,
      prescription_access_status: booking.prescription_access_status,
    },
  });
});

exports.getMyBookings = catchAsync(async (req, res, next) => {
  const { user_id, user_type } = req.user;
  const { date } = req.query;

  let filter = {};

  if (user_type === "patient") {
    filter.patient_user_id = user_id;
  } else if (user_type === "doctor") {
    const doctor = await Doctor.findOne({ user_id }).lean();
    if (!doctor) return next(new AppError("Access denied", 403));
    filter.doctor_id = doctor._id;
  } else if (user_type === "staff") {
    const staff = await Staff.findOne({ user_id }).lean();
    if (!staff) return next(new AppError("Access denied", 403));
    filter.staff_id = staff._id;
  } else {
    return next(new AppError("Access denied", 403));
  }

  if (date) filter.booking_date = date;

  const bookings = await Booking.find(filter).sort({ booking_date: 1, booking_from: 1 }).lean();

  const result = await Promise.all(bookings.map(async (b) => {
    const patient = await Patient.findOne({ user_id: b.patient_user_id }).populate("user_id", "photo").lean();
    let doctor_name = null;
    if (b.doctor_id) {
      const doc = await Doctor.findById(b.doctor_id).lean();
      doctor_name = doc?.full_name || null;
    } else if (b.staff_id) {
      const st = await Staff.findById(b.staff_id).lean();
      doctor_name = st?.full_name || null;
    }
    return {
      booking_id: b._id,
      booking_date: b.booking_date,
      booking_from: b.booking_from,
      booking_to: b.booking_to,
      status: b.status,
      prescription_access_status: b.prescription_access_status,
      prescription_access_requested_at: b.prescription_access_requested_at,
      prescription_access_responded_at: b.prescription_access_responded_at,
      patient_name: patient?.full_name || null,
      patient_phone: patient?.phone || null,
      patient_photo: patient?.user_id?.photo || null,
      doctor_name,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, bookings: result });
});

exports.getClinicBookings = catchAsync(async (req, res) => {
  const clinic_id = req.clinic.clinic_id;
  const { date } = req.query;

  const staffList = await Staff.find({ clinic_id }).lean();
  const staffIds = staffList.map((s) => s._id);

  const filter = { staff_id: { $in: staffIds } };
  if (date) filter.booking_date = date;

  const bookings = await Booking.find(filter).sort({ booking_date: 1, booking_from: 1 }).lean();

  const result = await Promise.all(bookings.map(async (b) => {
    const patient = await Patient.findOne({ user_id: b.patient_user_id }).lean();
    const staff = b.staff_id ? staffList.find((s) => String(s._id) === String(b.staff_id)) : null;
    const clinic = await Clinic.findById(clinic_id).select("name").lean();
    return {
      id: b._id,
      booking_id: b._id,
      doctor_id: b.doctor_id,
      staff_id: b.staff_id,
      booking_date: b.booking_date,
      booking_from: b.booking_from,
      booking_to: b.booking_to,
      status: b.status,
      prescription_access_status: b.prescription_access_status,
      prescription_access_requested_at: b.prescription_access_requested_at,
      prescription_access_responded_at: b.prescription_access_responded_at,
      patient_name: patient?.full_name || null,
      patient_phone: patient?.phone || null,
      doctor_name: staff?.full_name || null,
      clinic_name: clinic?.name || null,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, bookings: result });
});

exports.getAvailableSlots = catchAsync(async (req, res, next) => {
  const { doctor_id, staff_id, booking_date } = req.query;

  if ((!doctor_id && !staff_id) || (doctor_id && staff_id)) return next(new AppError("doctor_id or staff_id is required", 400));
  if (!booking_date) return next(new AppError("booking_date is required", 400));

  let target;
  if (doctor_id) {
    target = await Doctor.findById(doctor_id).select("work_days work_from work_to is_verified").lean();
    if (!target || !target.is_verified) return next(new AppError("Doctor is not available", 404));
  } else {
    target = await Staff.findById(staff_id).select("work_days work_from work_to is_verified").lean();
    if (!target || !target.work_days || !target.work_from || !target.work_to || !target.is_verified) return next(new AppError("Doctor is not available", 404));
  }

  const day = new Date(booking_date).toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const allowedDays = (target.work_days || "").split(",").map((d) => d.trim().toLowerCase());
  if (!allowedDays.includes(day)) return res.json({ status: "success", slots: [] });

  const allSlots = generateSlots(target.work_from, target.work_to, 30);

  const matchField = doctor_id ? { doctor_id } : { staff_id };
  const bookings = await Booking.find({ ...matchField, booking_date, status: "confirmed" }).lean();

  const availableSlots = allSlots.filter(
    (slot) => !bookings.some((b) => slot.from < b.booking_to && slot.to > b.booking_from)
  );

  res.json({ status: "success", slots: availableSlots });
});

exports.cancelBooking = catchAsync(async (req, res, next) => {
  const booking_id = parseId(req.params.id);
  if (!booking_id) return next(new AppError("Invalid booking id", 400));
  const { user_id, user_type } = req.user;

  const booking = await Booking.findById(booking_id).lean();
  if (!booking) return next(new AppError("Booking not found", 404));
  if (booking.status === "cancelled") return next(new AppError("Booking is already cancelled", 400));

  let authorized = false;

  if (user_type === "patient") {
    authorized = String(booking.patient_user_id) === String(user_id);
  }

  if (user_type === "doctor" && booking.doctor_id) {
    const doctor = await Doctor.findOne({ user_id }).lean();
    authorized = doctor && String(doctor._id) === String(booking.doctor_id);
  }

  if (user_type === "staff" && booking.staff_id) {
    const staff = await Staff.findOne({ user_id }).lean();
    authorized = staff && String(staff._id) === String(booking.staff_id);
  }

  if (!authorized) return next(new AppError("Access denied", 403));

  await Booking.findByIdAndUpdate(booking_id, { 
    status: "cancelled",
    prescription_access_status: "rejected" 
  });

  await createNotification({ user_id: booking.patient_user_id, title: "تم إلغاء الحجز", message: "تم إلغاء حجزك." });

  res.status(200).json({ status: "success", message: "تم إلغاء الحجز بنجاح" });
});

exports.cancelClinicBooking = catchAsync(async (req, res, next) => {
  const booking_id = parseId(req.params.id);
  if (!booking_id) return next(new AppError("Invalid booking id", 400));
  const clinic_id = req.clinic.clinic_id;

  const booking = await Booking.findById(booking_id).populate("staff_id", "clinic_id").lean();
  if (!booking) return next(new AppError("Booking not found", 404));
  if (String(booking.staff_id?.clinic_id) !== String(clinic_id)) return next(new AppError("Access denied", 403));
  if (booking.status === "cancelled") return next(new AppError("Booking is already cancelled", 400));

  await Booking.findByIdAndUpdate(booking_id, { 
    status: "cancelled",
    prescription_access_status: "rejected"
  });
  await createNotification({ user_id: booking.patient_user_id, title: "تم إلغاء الحجز", message: "تم إلغاء حجزك من قبل العيادة." });

  res.status(200).json({ status: "success", message: "تم إلغاء الحجز بنجاح" });
});
