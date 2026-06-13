const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");

const Doctor = require("../models/Doctor.model");
const Staff = require("../models/Staff.model");
const Patient = require("../models/Patient.model");
const Clinic = require("../models/Clinic.model");
const Booking = require("../models/Booking.model");
const Prescription = require("../models/Prescription.model");
const PrescriptionPermission = require("../models/PrescriptionPermission.model");

const parseId = (value, fieldName) => {
  if (!value || !require("mongoose").Types.ObjectId.isValid(value)) {
    throw new AppError(`Invalid ${fieldName}`, 400);
  }
  return value;
};

const normalizeText = (value, fieldName, maxLength) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppError(`${fieldName} must be a string`, 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new AppError(`${fieldName} must not exceed ${maxLength} characters`, 400);
  return trimmed;
};

const parseOptionalInteger = (value, fieldName, min = 0, max = 150) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new AppError(`${fieldName} must be an integer between ${min} and ${max}`, 400);
  return parsed;
};

const parseOptionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(`${fieldName} must be a valid date`, 400);
  return parsed;
};

const resolveAccessAction = (value) => {
  if (typeof value !== "string") throw new AppError("action is required", 400);
  const normalized = value.trim().toLowerCase();
  if (normalized === "accept" || normalized === "accepted") return "accepted";
  if (normalized === "reject" || normalized === "rejected") return "rejected";
  throw new AppError("action must be accept or reject", 400);
};

const formatDate = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
};

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

const parsePrescriptionBody = (body) => {
  const payload = {
    patient_age: parseOptionalInteger(body.patient_age, "patient_age"),
    visit_date: parseOptionalDate(body.visit_date, "visit_date"),
    symptoms: normalizeText(body.symptoms, "symptoms", 500),
    diagnosis: normalizeText(body.diagnosis, "diagnosis", 500),
    medication_name: normalizeText(body.medication_name, "medication_name", 150),
    dose: normalizeText(body.dose, "dose", 100),
    duration: normalizeText(body.duration, "duration", 100),
    test_name: normalizeText(body.test_name, "test_name", 150),
    test_result: normalizeText(body.test_result, "test_result", 500),
    test_date: parseOptionalDate(body.test_date, "test_date"),
    notes: normalizeText(body.notes, "notes", 500),
  };

  const hasMedicalContent = [payload.symptoms, payload.diagnosis, payload.medication_name, payload.test_name, payload.notes].some(Boolean);
  if (!hasMedicalContent) throw new AppError("At least one of symptoms, diagnosis, medication_name, test_name, or notes is required", 400);
  if ((payload.dose || payload.duration) && !payload.medication_name) throw new AppError("medication_name is required when dose or duration is provided", 400);
  if ((payload.test_result || payload.test_date) && !payload.test_name) throw new AppError("test_name is required when test_result or test_date is provided", 400);

  return payload;
};

const getProviderProfile = async (user) => {
  if (user.user_type === "doctor") {
    const doctor = await Doctor.findOne({ user_id: user.user_id, is_verified: true }).lean();
    if (!doctor) throw new AppError("Doctor profile not found", 404);
    return { provider_type: "doctor", doctor_id: doctor._id, staff_id: null, user_id: doctor.user_id, full_name: doctor.full_name, specialist: doctor.specialist, contact_phone: doctor.phone };
  }

  if (user.user_type === "staff") {
    const staff = await Staff.findOne({ user_id: user.user_id, work_days: { $ne: null }, work_from: { $ne: null }, work_to: { $ne: null }, is_verified: true }).lean();
    if (!staff) throw new AppError("Doctor staff profile not found", 404);
    return { provider_type: "staff", doctor_id: null, staff_id: staff._id, user_id: staff.user_id, full_name: staff.full_name, specialist: staff.specialist, contact_phone: null };
  }

  throw new AppError("Only doctors can manage prescriptions", 403);
};

const getBookingDetails = async (bookingId) => {
  const booking = await Booking.findById(bookingId)
    .populate("patient_user_id", "is_active")
    .lean();
  if (!booking) return null;

  const patient = await Patient.findOne({ user_id: booking.patient_user_id?._id || booking.patient_user_id }).lean();
  let directDoctor = null;
  let staffDoctor = null;
  let clinicPhone = null;

  if (booking.doctor_id) {
    directDoctor = await Doctor.findById(booking.doctor_id).lean();
  }
  if (booking.staff_id) {
    staffDoctor = await Staff.findById(booking.staff_id).lean();
    if (staffDoctor?.clinic_id) {
      const clinic = await Clinic.findById(staffDoctor.clinic_id).lean();
      clinicPhone = clinic?.phone || null;
    }
  }

  return {
    ...booking,
    patient_user_id: booking.patient_user_id?._id || booking.patient_user_id,
    patient_id: patient?._id || null,
    patient_name: patient?.full_name || null,
    date_of_birth: patient?.date_of_birth || null,
    direct_doctor_user_id: directDoctor?.user_id || null,
    direct_doctor_name: directDoctor?.full_name || null,
    direct_doctor_specialist: directDoctor?.specialist || null,
    direct_doctor_phone: directDoctor?.phone || null,
    staff_doctor_user_id: staffDoctor?.user_id || null,
    staff_doctor_name: staffDoctor?.full_name || null,
    staff_doctor_specialist: staffDoctor?.specialist || null,
    clinic_phone: clinicPhone,
  };
};

const bookingBelongsToProvider = (booking, provider) => {
  if (provider.provider_type === "doctor") return String(booking.doctor_id) === String(provider.doctor_id);
  return String(booking.staff_id) === String(provider.staff_id);
};

const getPrescriptionByBooking = async (bookingId) =>
  Prescription.findOne({ booking_id: bookingId }).lean();

const getSavedPrescriptionPermission = async (patientUserId, booking) => {
  const query = { patient_user_id: patientUserId, status: "accepted" };
  if (booking.doctor_id) query.doctor_id = booking.doctor_id;
  else query.staff_id = booking.staff_id;
  return PrescriptionPermission.findOne(query).lean();
};

const upsertPrescriptionPermission = async (patientUserId, booking, permissionStatus) => {
  const query = { patient_user_id: patientUserId };
  if (booking.doctor_id) query.doctor_id = booking.doctor_id;
  else query.staff_id = booking.staff_id;

  const existing = await PrescriptionPermission.findOne(query).lean();
  if (existing) {
    const update = { status: permissionStatus, updated_at: new Date() };
    if (permissionStatus === "accepted") update.accepted_at = new Date();
    return PrescriptionPermission.findByIdAndUpdate(existing._id, update);
  }

  return PrescriptionPermission.create({
    patient_user_id: patientUserId,
    doctor_id: booking.doctor_id || null,
    staff_id: booking.staff_id || null,
    status: permissionStatus,
  });
};

const buildPrescriptionViewerScope = async (user) => {
  if (user.user_type === "patient") {
    const patient = await Patient.findOne({ user_id: user.user_id }).lean();
    if (!patient) throw new AppError("Patient profile not found", 404);
    return { patientId: patient._id, doctorId: null, staffId: null };
  }

  const provider = await getProviderProfile(user);
  return {
    patientId: null,
    doctorId: provider.doctor_id || null,
    staffId: provider.staff_id || null,
  };
};

exports.requestPrescriptionAccess = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const provider = await getProviderProfile(req.user);
  const booking = await getBookingDetails(bookingId);

  if (!booking) return next(new AppError("Booking not found", 404));
  if (!bookingBelongsToProvider(booking, provider)) return next(new AppError("You can only request access for your own booking", 403));
  if (booking.status !== "confirmed") return next(new AppError("Prescription access can only be requested for confirmed bookings", 400));

  const existingPrescription = await getPrescriptionByBooking(bookingId);
  if (existingPrescription) return next(new AppError("A prescription already exists for this booking", 400));

  const savedPermission = await getSavedPrescriptionPermission(booking.patient_user_id, booking);

  if (savedPermission || booking.prescription_access_status === "accepted") {
    await Booking.findByIdAndUpdate(bookingId, {
      prescription_access_status: "accepted",
      prescription_access_requested_at: null,
      prescription_access_responded_at: booking.prescription_access_responded_at || new Date(),
    });
    return res.status(200).json({
      status: "success",
      message: "Prescription access is already approved for this doctor",
      booking: { booking_id: bookingId, prescription_access_status: "accepted" },
    });
  }

  if (booking.prescription_access_status === "pending") return next(new AppError("Prescription access is already pending patient approval", 400));

  await Booking.findByIdAndUpdate(bookingId, {
    prescription_access_status: "pending",
    prescription_access_requested_at: new Date(),
    prescription_access_responded_at: null,
  });

  await createNotification({
    user_id: booking.patient_user_id,
    title: "طلب صلاحية كتابة روشتة",
    message: `طلب ${provider.full_name} إذنك لكتابة روشتة لحجزك بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(200).json({
    status: "success",
    message: "Prescription access request sent successfully",
    booking: { booking_id: bookingId, prescription_access_status: "pending" },
  });
});

exports.respondToPrescriptionAccess = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const nextStatus = resolveAccessAction(req.body.action);
  const booking = await getBookingDetails(bookingId);

  if (!booking) return next(new AppError("Booking not found", 404));
  if (String(booking.patient_user_id) !== String(req.user.user_id)) return next(new AppError("You can only respond to your own booking requests", 403));
  if (booking.status !== "confirmed") return next(new AppError("Only confirmed bookings can receive prescription access approval", 400));

  const currentStatus = booking.prescription_access_status;
  const isRevocation = (currentStatus === "accepted" && nextStatus === "rejected");
  const isReAcceptance = (currentStatus === "rejected" && nextStatus === "accepted");

  if (currentStatus !== "pending" && !isRevocation && !isReAcceptance) return next(new AppError("No active prescription access request to respond to", 400));

  const providerUserId = booking.direct_doctor_user_id || booking.staff_doctor_user_id;
  if (!providerUserId) return next(new AppError("Booking provider not found", 404));

  await upsertPrescriptionPermission(booking.patient_user_id, booking, nextStatus === "accepted" ? "accepted" : "revoked");

  await Booking.findByIdAndUpdate(bookingId, {
    prescription_access_status: nextStatus,
    prescription_access_responded_at: new Date(),
  });

  await createNotification({
    user_id: providerUserId,
    title: "رد على طلب صلاحية الروشتة",
    message: `قام ${booking.patient_name} بـ${nextStatus === "accepted" ? "قبول" : "رفض"} طلب كتابة الروشتة لحجز بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(200).json({
    status: "success",
    message: `Prescription access ${nextStatus} successfully`,
    booking: { booking_id: bookingId, prescription_access_status: nextStatus },
  });
});

exports.createPrescription = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const provider = await getProviderProfile(req.user);
  const booking = await getBookingDetails(bookingId);

  if (!booking) return next(new AppError("Booking not found", 404));
  if (!bookingBelongsToProvider(booking, provider)) return next(new AppError("You can only create prescriptions for your own booking", 403));
  if (booking.status !== "confirmed") return next(new AppError("Only confirmed bookings can receive a prescription", 400));
  if (booking.prescription_access_status !== "accepted") return next(new AppError("Patient approval is required before creating a prescription", 403));

  const existingPrescription = await getPrescriptionByBooking(bookingId);
  if (existingPrescription) return next(new AppError("A prescription already exists for this booking", 409));

  const payload = parsePrescriptionBody(req.body);
  const patientAge = payload.patient_age ?? calculateAge(booking.date_of_birth);
  const providerName = booking.direct_doctor_name || booking.staff_doctor_name || provider.full_name;
  const providerSpecialty = booking.direct_doctor_specialist || booking.staff_doctor_specialist || provider.specialist;
  const providerContact = booking.direct_doctor_phone || booking.clinic_phone || provider.contact_phone;
  const visitDate = payload.visit_date || new Date();

  const prescription = await Prescription.create({
    booking_id: bookingId,
    patient_id: booking.patient_id,
    doctor_id: provider.doctor_id || null,
    staff_id: provider.staff_id || null,
    patient_age: patientAge,
    doctor_name: providerName,
    specialty: providerSpecialty,
    doctor_emergency_contact: providerContact,
    visit_date: visitDate,
    ...payload,
  });

  await Booking.findByIdAndUpdate(bookingId, {
    status: "completed",
  });

  await createNotification({
    user_id: booking.patient_user_id,
    title: "تحديث حالة الحجز",
    message: "تم تغيير حالة حجزك إلى: مكتمل.",
  });

  await createNotification({
    user_id: booking.patient_user_id,
    title: "روشتة جديدة",
    message: `أرسل ${providerName} روشتة لحجزك بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(201).json({
    status: "success",
    message: "Prescription created successfully",
    prescription: { prescription_id: prescription._id, booking_id: bookingId, prescription_access_status: booking.prescription_access_status },
  });
});

exports.getMyPrescriptions = catchAsync(async (req, res) => {
  const scope = await buildPrescriptionViewerScope(req.user);

  let filter = {};
  if (scope.patientId) filter.patient_id = scope.patientId;
  else if (scope.doctorId) filter.doctor_id = scope.doctorId;
  else if (scope.staffId) filter.staff_id = scope.staffId;

  const prescriptions = await Prescription.find(filter)
    .populate("patient_id", "full_name")
    .populate("booking_id", "booking_date booking_from booking_to")
    .populate("doctor_id", "full_name specialist")
    .populate("staff_id", "full_name specialist")
    .sort({ created_at: -1 })
    .lean();

  const result = prescriptions.map((pr) => ({
    prescription_id: pr._id,
    booking_id: pr.booking_id?._id,
    patient_age: pr.patient_age,
    visit_date: pr.visit_date,
    symptoms: pr.symptoms,
    diagnosis: pr.diagnosis,
    medication_name: pr.medication_name,
    dose: pr.dose,
    duration: pr.duration,
    test_name: pr.test_name,
    test_result: pr.test_result,
    test_date: pr.test_date,
    notes: pr.notes,
    created_at: pr.created_at,
    patient_name: pr.patient_id?.full_name,
    provider_name: pr.doctor_id?.full_name || pr.staff_id?.full_name || pr.doctor_name,
    provider_specialty: pr.doctor_id?.specialist || pr.staff_id?.specialist || pr.specialty,
    booking_date: pr.booking_id?.booking_date,
    booking_from: pr.booking_id?.booking_from,
    booking_to: pr.booking_id?.booking_to,
    prescriber_type: pr.doctor_id ? "doctor" : "staff",
  }));

  res.status(200).json({ status: "success", results: result.length, prescriptions: result });
});

exports.getPrescriptionById = catchAsync(async (req, res, next) => {
  const prescriptionId = parseId(req.params.id, "prescription id");
  const scope = await buildPrescriptionViewerScope(req.user);

  let filter = { _id: prescriptionId };
  if (scope.patientId) filter.patient_id = scope.patientId;
  else if (scope.doctorId) filter.doctor_id = scope.doctorId;
  else if (scope.staffId) filter.staff_id = scope.staffId;

  const pr = await Prescription.findOne(filter)
    .populate("patient_id", "full_name")
    .populate("booking_id", "booking_date booking_from booking_to")
    .populate("doctor_id", "full_name specialist")
    .populate("staff_id", "full_name specialist")
    .lean();

  if (!pr) return next(new AppError("Prescription not found", 404));

  res.status(200).json({
    status: "success",
    prescription: {
      prescription_id: pr._id,
      booking_id: pr.booking_id?._id,
      patient_age: pr.patient_age,
      visit_date: pr.visit_date,
      symptoms: pr.symptoms,
      diagnosis: pr.diagnosis,
      medication_name: pr.medication_name,
      dose: pr.dose,
      duration: pr.duration,
      test_name: pr.test_name,
      test_result: pr.test_result,
      test_date: pr.test_date,
      notes: pr.notes,
      doctor_name: pr.doctor_name,
      specialty: pr.specialty,
      doctor_emergency_contact: pr.doctor_emergency_contact,
      created_at: pr.created_at,
      patient_name: pr.patient_id?.full_name,
      provider_name: pr.doctor_id?.full_name || pr.staff_id?.full_name || pr.doctor_name,
      provider_specialty: pr.doctor_id?.specialist || pr.staff_id?.specialist || pr.specialty,
      booking_date: pr.booking_id?.booking_date,
      booking_from: pr.booking_id?.booking_from,
      booking_to: pr.booking_id?.booking_to,
      prescriber_type: pr.doctor_id ? "doctor" : "staff",
    },
  });
});
