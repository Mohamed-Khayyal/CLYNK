const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const mongoose = require("mongoose");
const Booking = require("../models/Booking.model");
const Payment = require("../models/Payment.model");
const Doctor = require("../models/Doctor.model");
const Staff = require("../models/Staff.model");
const Clinic = require("../models/Clinic.model");
const Patient = require("../models/Patient.model");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

exports.confirmDoctorPayment = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId);
  if (!bookingId) return next(new AppError("Invalid booking ID", 400));

  const booking = await Booking.findOne({ _id: bookingId, doctor_id: { $ne: null } });
  if (!booking) return next(new AppError("Booking not found", 404));

  const doctor = await Doctor.findOne({ _id: booking.doctor_id }).lean();
  if (!doctor || String(doctor.user_id) !== String(req.user.user_id)) {
    return next(new AppError("Unauthorized action", 403));
  }

  const existingPayment = await Payment.findOne({ booking_id: bookingId }).lean();
  if (existingPayment) {
    return next(new AppError("Payment already confirmed for this booking", 400));
  }

  // Update booking status to confirmed
  booking.status = "confirmed";
  await booking.save();

  const amount = doctor.consultation_price || 0;

  const payment = await Payment.create({
    booking_id: booking._id,
    doctor_id: doctor._id,
    patient_id: booking.patient_user_id,
    amount,
    currency: "EGP",
  });

  res.status(201).json({
    status: "success",
    message: "Payment confirmed successfully",
    payment,
  });
});

exports.confirmStaffPayment = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId);
  if (!bookingId) return next(new AppError("Invalid booking ID", 400));

  const booking = await Booking.findOne({ _id: bookingId, staff_id: { $ne: null } });
  if (!booking) return next(new AppError("Booking not found", 404));

  const staff = await Staff.findOne({ _id: booking.staff_id }).lean();
  if (!staff) return next(new AppError("Staff member not found", 404));

  const clinic = await Clinic.findOne({ _id: staff.clinic_id }).lean();
  if (!clinic || String(clinic.owner_user_id) !== String(req.user.user_id)) {
    return next(new AppError("Unauthorized action. Only clinic owner can confirm.", 403));
  }

  const existingPayment = await Payment.findOne({ booking_id: bookingId }).lean();
  if (existingPayment) {
    return next(new AppError("Payment already confirmed for this booking", 400));
  }

  // Update booking status to confirmed
  booking.status = "confirmed";
  await booking.save();

  const amount = staff.consultation_price || 0;
  const staffAmount = amount * 0.8;
  const clinicAmount = amount * 0.2;

  const payment = await Payment.create({
    booking_id: booking._id,
    clinic_id: clinic._id,
    staff_id: staff._id,
    patient_id: booking.patient_user_id,
    amount,
    currency: "EGP",
    split: {
      staff_amount: staffAmount,
      clinic_amount: clinicAmount,
    },
  });

  res.status(201).json({
    status: "success",
    message: "Staff payment confirmed successfully",
    payment,
  });
});

exports.confirmStaffSelfPayment = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId);
  if (!bookingId) return next(new AppError("Invalid booking ID", 400));

  const booking = await Booking.findOne({ _id: bookingId, staff_id: { $ne: null } });
  if (!booking) return next(new AppError("Booking not found", 404));

  const staff = await Staff.findOne({ user_id: req.user.user_id }).lean();
  if (!staff || String(staff._id) !== String(booking.staff_id)) {
    return next(new AppError("Unauthorized action. You can only confirm your own bookings.", 403));
  }

  const existingPayment = await Payment.findOne({ booking_id: bookingId }).lean();
  if (existingPayment) {
    return next(new AppError("Payment already confirmed for this booking", 400));
  }

  // Update booking status to confirmed
  booking.status = "confirmed";
  await booking.save();

  const amount = staff.consultation_price || 0;
  const staffAmount = amount * 0.8;
  const clinicAmount = amount * 0.2;

  const payment = await Payment.create({
    booking_id: booking._id,
    clinic_id: staff.clinic_id,
    staff_id: staff._id,
    patient_id: booking.patient_user_id,
    amount,
    currency: "EGP",
    split: {
      staff_amount: staffAmount,
      clinic_amount: clinicAmount,
    },
  });

  res.status(201).json({
    status: "success",
    message: "Payment confirmed successfully",
    payment,
  });
});

exports.undoPayment = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId);
  if (!bookingId) return next(new AppError("Invalid booking ID", 400));

  const payment = await Payment.findOne({ booking_id: bookingId });
  if (!payment) return next(new AppError("Payment not found", 404));

  const booking = await Booking.findById(bookingId);
  if (!booking) return next(new AppError("Booking not found", 404));

  if (req.user.role === 'doctor') {
    const doctor = await Doctor.findById(booking.doctor_id).lean();
    if (!doctor || String(doctor.user_id) !== String(req.user.user_id)) {
      return next(new AppError("Unauthorized action", 403));
    }
  } else if (req.user.role === 'clinic') {
    const staff = await Staff.findById(booking.staff_id).lean();
    if (!staff) return next(new AppError("Staff not found", 404));
    const clinic = await Clinic.findById(staff.clinic_id).lean();
    if (!clinic || String(clinic.owner_user_id) !== String(req.user.user_id)) {
      return next(new AppError("Unauthorized action", 403));
    }
  } else if (req.user.role === 'staff') {
    const staff = await Staff.findById(booking.staff_id).lean();
    if (!staff || String(staff.user_id) !== String(req.user.user_id)) {
      return next(new AppError("Unauthorized action", 403));
    }
  }

  await Payment.findByIdAndDelete(payment._id);

  booking.status = "pending";
  await booking.save();

  res.status(200).json({
    status: "success",
    message: "Payment undone successfully"
  });
});

exports.getDoctorFinancials = catchAsync(async (req, res, next) => {
  const doctor = await Doctor.findOne({ user_id: req.user.user_id }).lean();
  if (!doctor) return next(new AppError("Doctor not found", 404));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const agg = await Payment.aggregate([
    { $match: { doctor_id: doctor._id, status: "completed" } },
    { $group: { _id: null, total_earnings: { $sum: "$amount" } } }
  ]);

  const totalEarnings = agg[0]?.total_earnings || 0;

  const payments = await Payment.find({ doctor_id: doctor._id, status: "completed" })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate("patient_id", "full_name")
    .lean();
    
  // Need to get patient names. Since patient_id is ref to User, but we want Patient model.
  const patientIds = payments.map(p => p.patient_id?._id || p.patient_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map(p => [String(p.user_id), p]));

  const results = payments.map(p => ({
    payment_id: p._id,
    booking_id: p.booking_id,
    amount: p.amount,
    currency: p.currency,
    date: p.created_at,
    patient_name: patientMap[String(p.patient_id?._id || p.patient_id)]?.full_name || "Unknown Patient"
  }));

  const totalCount = await Payment.countDocuments({ doctor_id: doctor._id, status: "completed" });

  res.status(200).json({
    status: "success",
    summary: { total_earnings: totalEarnings, currency: "EGP" },
    pagination: { page, limit, total_pages: Math.ceil(totalCount / limit) },
    payments: results
  });
});

exports.getClinicFinancials = catchAsync(async (req, res, next) => {
  const clinic = await Clinic.findOne({ owner_user_id: req.user.user_id }).lean();
  if (!clinic) return next(new AppError("Clinic not found", 404));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const agg = await Payment.aggregate([
    { $match: { clinic_id: clinic._id, status: "completed" } },
    { $group: { 
        _id: null, 
        total_revenue: { $sum: "$amount" },
        clinic_earnings: { $sum: "$split.clinic_amount" },
        staff_earnings: { $sum: "$split.staff_amount" }
      } 
    }
  ]);

  const stats = agg[0] || { total_revenue: 0, clinic_earnings: 0, staff_earnings: 0 };

  const payments = await Payment.find({ clinic_id: clinic._id, status: "completed" })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate("staff_id", "full_name")
    .lean();

  const patientIds = payments.map(p => p.patient_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map(p => [String(p.user_id), p]));

  const results = payments.map(p => ({
    payment_id: p._id,
    booking_id: p.booking_id,
    amount: p.amount,
    clinic_share: p.split?.clinic_amount || 0,
    staff_share: p.split?.staff_amount || 0,
    currency: p.currency,
    date: p.created_at,
    staff_name: p.staff_id?.full_name || "Unknown Staff",
    patient_name: patientMap[String(p.patient_id)]?.full_name || "Unknown Patient"
  }));

  const totalCount = await Payment.countDocuments({ clinic_id: clinic._id, status: "completed" });

  res.status(200).json({
    status: "success",
    summary: { 
      total_revenue: stats.total_revenue,
      clinic_earnings: stats.clinic_earnings,
      staff_earnings: stats.staff_earnings,
      currency: "EGP"
    },
    pagination: { page, limit, total_pages: Math.ceil(totalCount / limit) },
    payments: results
  });
});

exports.getStaffFinancials = catchAsync(async (req, res, next) => {
  const staff = await Staff.findOne({ user_id: req.user.user_id }).lean();
  if (!staff) return next(new AppError("Staff not found", 404));

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const agg = await Payment.aggregate([
    { $match: { staff_id: staff._id, status: "completed" } },
    { $group: { _id: null, total_earnings: { $sum: "$split.staff_amount" } } }
  ]);

  const totalEarnings = agg[0]?.total_earnings || 0;

  const payments = await Payment.find({ staff_id: staff._id, status: "completed" })
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .populate("patient_id", "full_name")
    .lean();
    
  const patientIds = payments.map(p => p.patient_id?._id || p.patient_id);
  const patients = await Patient.find({ user_id: { $in: patientIds } }).lean();
  const patientMap = Object.fromEntries(patients.map(p => [String(p.user_id), p]));

  const results = payments.map(p => ({
    payment_id: p._id,
    booking_id: p.booking_id,
    amount: p.split?.staff_amount || p.amount,
    currency: p.currency,
    date: p.created_at,
    patient_name: patientMap[String(p.patient_id?._id || p.patient_id)]?.full_name || "Unknown Patient"
  }));

  const totalCount = await Payment.countDocuments({ staff_id: staff._id, status: "completed" });

  res.status(200).json({
    status: "success",
    summary: { total_earnings: totalEarnings, currency: "EGP" },
    pagination: { page, limit, total_pages: Math.ceil(totalCount / limit) },
    payments: results
  });
});

exports.seedFinancials = catchAsync(async (req, res, next) => {
  const clinic = await Clinic.findOne({ owner_user_id: req.user.user_id }).lean();
  if (!clinic) return next(new AppError("Only clinic owners can seed data", 403));

  const staffMembers = await Staff.find({ clinic_id: clinic._id }).lean();
  if (!staffMembers.length) {
    return next(new AppError("Please add staff members first", 400));
  }

  let patient = await Patient.findOne().lean();
  if (!patient) {
    // If no patient exists, we can't create bookings
    return next(new AppError("Please create at least one patient account first", 400));
  }

  const generatedBookings = [];
  const generatedPayments = [];

  const statuses = ["pending", "completed", "cancelled"];

  for (const staff of staffMembers) {
    const consultationPrice = staff.consultation_price || 300;
    
    // Generate 5 random bookings for each staff
    for (let i = 0; i < 5; i++) {
      const date = new Date();
      date.setDate(date.getDate() - Math.floor(Math.random() * 30)); // random day in last 30 days
      const bookingDate = date.toISOString().slice(0, 10);
      
      const status = statuses[Math.floor(Math.random() * statuses.length)];

      const booking = await Booking.create({
        patient_user_id: patient.user_id,
        staff_id: staff._id,
        booking_date: bookingDate,
        booking_from: "10:00",
        booking_to: "10:30",
        status: status === "completed" ? "confirmed" : status === "cancelled" ? "cancelled" : "pending"
      });
      generatedBookings.push(booking);

      if (status === "completed") {
        const staffAmount = consultationPrice * 0.8;
        const clinicAmount = consultationPrice * 0.2;
        
        const payment = await Payment.create({
          booking_id: booking._id,
          clinic_id: clinic._id,
          staff_id: staff._id,
          patient_id: patient.user_id,
          amount: consultationPrice,
          currency: "EGP",
          split: {
            staff_amount: staffAmount,
            clinic_amount: clinicAmount
          },
          status: "completed"
        });
        generatedPayments.push(payment);
      }
    }
  }

  res.status(201).json({
    status: "success",
    message: `Seeded ${generatedBookings.length} bookings and ${generatedPayments.length} payments`,
    bookings: generatedBookings.length,
    payments: generatedPayments.length
  });
});
