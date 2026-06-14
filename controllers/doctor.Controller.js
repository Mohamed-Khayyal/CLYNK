const mongoose = require("mongoose");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");

const Doctor = require("../models/Doctor.model");
const Staff = require("../models/Staff.model");
const Clinic = require("../models/Clinic.model");
const Booking = require("../models/Booking.model");
const Prescription = require("../models/Prescription.model");
const Rating = require("../models/Rating.model");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
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

exports.getDoctors = catchAsync(async (req, res) => {
  const { specialist } = req.query;
  const filter = { is_verified: true };
  if (specialist) filter.specialist = specialist;

  const doctors = await Doctor.find(filter)
    .populate("user_id", "photo is_active")
    .sort({ years_of_experience: -1, full_name: 1 })
    .lean();

  const active = doctors.filter((d) => d.user_id?.is_active);

  const result = await Promise.all(active.map(async (d) => {
    const bookingAgg = await Booking.aggregate([
      { $match: { doctor_id: d._id, status: "confirmed" } },
      { $group: { _id: null, total: { $sum: 1 }, patients: { $addToSet: "$patient_user_id" } } },
    ]);
    const total_bookings = bookingAgg[0]?.total || 0;
    const total_patients = bookingAgg[0]?.patients?.length || 0;
    const ratings = await getRatings({ doctor_id: d._id });

    return {
      doctor_id: d._id,
      full_name: d.full_name,
      gender: d.gender,
      years_of_experience: d.years_of_experience,
      bio: d.bio,
      consultation_price: d.consultation_price,
      work_from: d.work_from,
      work_to: d.work_to,
      work_days: d.work_days,
      location: d.location,
      geo_location: formatGeo(d.geo_location),
      specialist: d.specialist,
      photo: d.user_id?.photo,
      total_bookings,
      total_patients,
      ...ratings,
      can_be_booked: true,
    };
  }));

  res.status(200).json({ status: "success", results: result.length, doctors: result });
});

exports.getDoctorProfile = catchAsync(async (req, res, next) => {
  const doctor_id = parseId(req.params.id);
  if (!doctor_id) return next(new AppError("Invalid doctor id", 400));
  if (!doctor_id) return next(new AppError("Invalid doctor id", 400));

  let isStaff = false;
  let doctor = await Doctor.findOne({ _id: doctor_id, is_verified: true })
    .populate("user_id", "email photo is_active")
    .lean();

  if (!doctor) {
    const staff = await Staff.findOne({ _id: doctor_id, is_verified: true })
      .populate("user_id", "email photo is_active")
      .lean();
    if (staff) {
      doctor = staff;
      isStaff = true;
    }
  }

  if (!doctor || !doctor.user_id?.is_active) return next(new AppError("Doctor not found or unavailable for booking", 404));

  const matchField = isStaff ? { staff_id: doctor._id, status: "confirmed" } : { doctor_id: doctor._id, status: "confirmed" };
  const bookingAgg = await Booking.aggregate([
    { $match: matchField },
    { $group: { _id: null, total: { $sum: 1 }, patients: { $addToSet: "$patient_user_id" } } },
  ]);
  const total_bookings = bookingAgg[0]?.total || 0;
  const total_patients = bookingAgg[0]?.patients?.length || 0;
  
  const ratingsMatchField = isStaff ? { staff_id: doctor._id } : { doctor_id: doctor._id };
  const ratings = await getRatings(ratingsMatchField);

  res.status(200).json({
    status: "success",
    doctor: {
      doctor_id: doctor._id,
      user_id: doctor.user_id?._id,
      email: doctor.user_id?.email,
      full_name: doctor.full_name,
      phone: doctor.phone,
      gender: doctor.gender,
      specialist: doctor.specialist,
      work_days: doctor.work_days,
      work_from: doctor.work_from,
      work_to: doctor.work_to,
      location: doctor.location,
      geo_location: formatGeo(doctor.geo_location),
      consultation_price: doctor.consultation_price,
      years_of_experience: doctor.years_of_experience,
      bio: doctor.bio,
      is_verified: doctor.is_verified,
      photo: doctor.user_id?.photo,
      total_bookings,
      total_patients,
      ...ratings,
    },
  });
});

exports.getDoctorDashboard = catchAsync(async (req, res, next) => {
  const user_id = req.user.user_id;

  let doctor_id = null;
  let staff_id = null;
  let profileType = "doctor";
  let specialistName = "General";
  let providerDoc = null;

  const doctor = await Doctor.findOne({ user_id }).lean();
  if (doctor) {
    doctor_id = doctor._id;
    specialistName = doctor.specialist || "General";
    providerDoc = doctor;
  } else {
    const staff = await Staff.findOne({
      user_id,
    }).lean();
    if (!staff) return next(new AppError("Doctor profile not found", 404));
    staff_id = staff._id;
    profileType = "staff";
    specialistName = staff.specialist || "General";
    providerDoc = staff;
  }

  const filter = doctor_id ? { doctor_id } : { staff_id };
  const bookingsList = await Booking.find(filter).sort({ booking_date: -1, booking_from: -1 }).lean();

  const ratingsData = await getRatings(doctor_id ? { doctor_id } : { staff_id });

  const getFormattedDate = (v) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  };

  const buildLastSevenDays = () => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
  };

  const buildWeeklyPatients = (bookings) => {
    const last7Days = buildLastSevenDays();
    return last7Days.map((dateStr) => {
      const dayBookings = bookings.filter((b) => getFormattedDate(b.booking_date) === dateStr);
      const seen = new Set();
      for (const b of bookings) {
        const bDate = getFormattedDate(b.booking_date);
        if (!b.patient_user_id || bDate >= dateStr) continue;
        seen.add(String(b.patient_user_id));
      }
      let newPatients = 0;
      const returning = new Set();
      for (const b of dayBookings) {
        if (!b.patient_user_id) continue;
        const pid = String(b.patient_user_id);
        if (seen.has(pid)) {
          returning.add(pid);
        } else {
          newPatients += 1;
          seen.add(pid);
        }
      }
      return { date: dateStr, exixiting: returning.size, new: newPatients };
    });
  };

  const buildTrend = (total) => {
    const safeTotal = Math.max(total, 1);
    return Array.from({ length: 5 }, (_, i) => ({ value: Math.max(0, Math.round((safeTotal * (i + 1)) / 5)) }));
  };

  const uniquePatientsSet = new Set();
  const patientsMap = new Map();
  bookingsList.forEach((b) => {
    const key = String(b.patient_user_id);
    if (key) uniquePatientsSet.add(key);
    const existing = patientsMap.get(key);
    const bDate = getFormattedDate(b.booking_date);
    const eDate = existing ? getFormattedDate(existing.booking_date) : "";
    if (!existing || `${bDate} ${b.booking_from}` > `${eDate} ${existing.booking_from}`) {
      patientsMap.set(key, b);
    }
  });

  const totalBookings = bookingsList.length;
  const totalPatients = uniquePatientsSet.size;
  const pendingBookings = bookingsList.filter((b) => b.prescription_access_status === "pending");
  const completedBookings = await Prescription.find(doctor_id ? { doctor_id } : { staff_id }).lean();
  const cancelledBookings = bookingsList.filter((b) => b.status === "cancelled");
  const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings.length / totalBookings) * 100) : 0;

  // Fetch all unique patient details
  const PatientModel = require("../models/Patient.model");
  const patientUserIds = [...uniquePatientsSet];
  const patientsList = await PatientModel.find({ user_id: { $in: patientUserIds } }).populate("user_id", "photo gender").lean();
  const patientMap = new Map(patientsList.map(p => [String(p.user_id), p]));

  let maleCount = 0;
  let femaleCount = 0;
  patientsList.forEach((p) => {
    if (p.gender === "male") maleCount++;
    else if (p.gender === "female") femaleCount++;
  });

  const uniquePatientsList = [];
  const seenPatients = new Set();
  bookingsList.forEach((b) => {
    const pId = String(b.patient_user_id);
    if (!pId || seenPatients.has(pId)) return;
    
    seenPatients.add(pId);
    const patient = patientMap.get(pId);
    if (patient) {
      uniquePatientsList.push({
        name: patient.full_name,
        gender: patient.gender === "male" ? "ذكر" : patient.gender === "female" ? "أنثى" : "—",
        department: specialistName,
        date: getFormattedDate(b.booking_date),
      });
    }
  });

  // Fetch patient profiles for reports (prescriptions)
  const prescriptionPatientUserIds = [...new Set(completedBookings.map(rx => rx.patient_user_id).filter(Boolean))];
  const rxPatients = await PatientModel.find({ user_id: { $in: prescriptionPatientUserIds } }).lean();
  const rxPatientMap = new Map(rxPatients.map(p => [String(p.user_id), p]));

  const reportsList = completedBookings.slice(0, 5).map((rx) => {
    const patient = rxPatientMap.get(String(rx.patient_user_id));
    return {
      id: String(rx._id),
      name: patient?.full_name || "Patient",
      status: "available",
      description: rx.diagnosis || "تقرير طبي",
    };
  });

  const doctorObj = {
    full_name: providerDoc?.full_name || "General",
    specialist: specialistName,
    rating: ratingsData.average_rating,
    total_bookings: totalBookings,
    pending_bookings: pendingBookings.length,
    completed_bookings: completedBookings.length,
  };

  const todayDateStr = new Date().toISOString().slice(0, 10);

  const appointmentRows = bookingsList.map((b) => {
    const patient = patientMap.get(String(b.patient_user_id));
    return {
      id: String(b.patient_user_id || b._id),
      name: patient?.full_name || "Patient",
      type: "زيارة",
      doctor: doctorObj.full_name,
      status: b.status || "confirmed",
      date: [getFormattedDate(b.booking_date), b.booking_from].filter(Boolean).join(", "),
    };
  });

  const appointmentRequests = bookingsList
    .filter((b) => b.prescription_access_status === "pending")
    .slice(0, 5)
    .map((b) => {
      const patient = patientMap.get(String(b.patient_user_id));
      return {
        id: b._id,
        name: patient?.full_name || "Patient",
        specialty: specialistName || "General",
        time: [getFormattedDate(b.booking_date), b.booking_from].filter(Boolean).join(", "),
        image: patient?.user_id?.photo || "/images/blank-profile-picture.png",
        status: "pending",
      };
    });

  const todayAppointmentsList = bookingsList
    .filter((b) => getFormattedDate(b.booking_date) === todayDateStr)
    .sort((a, b) => (a.booking_from || "").localeCompare(b.booking_from || ""))
    .map((b) => {
      const patient = patientMap.get(String(b.patient_user_id));
      return {
        id: b._id,
        name: patient?.full_name || "Patient",
        type: b.status || "confirmed",
        date: getFormattedDate(b.booking_date),
        time: b.booking_from,
      };
    });

  res.status(200).json({
    status: "success",
    dashboard: {
      profile_type: profileType,
      doctor: doctorObj,
      totals: {
        appointments: totalBookings,
        patients: totalPatients,
        pending: doctorObj.pending_bookings,
        completed: doctorObj.completed_bookings,
        rating: doctorObj.rating,
        cancellationRate,
      },
      cards: {
        appointments: { value: totalBookings, percentage: 0, trend: buildTrend(totalBookings) },
        patients: { value: totalPatients, percentage: 0, trend: buildTrend(totalPatients) },
      },
      weeklyPatients: buildWeeklyPatients(bookingsList),
      genderStats: { male: maleCount, female: femaleCount, total: totalPatients },
      appointmentRequests,
      appointments: appointmentRows,
      patients: uniquePatientsList,
      reports: reportsList,
      todayAppointments: todayAppointmentsList,
    },
  });
});

exports.getBestDoctorsAndStaff = catchAsync(async (req, res) => {
  const { specialist } = req.query;
  const limit = Math.min(Number.isInteger(Number(req.query.limit)) && Number(req.query.limit) > 0 ? Math.floor(Number(req.query.limit)) : 20, 50);

  const doctorFilter = { is_verified: true };
  const staffFilter = { is_verified: true, work_days: { $ne: null }, work_from: { $ne: null }, work_to: { $ne: null } };

  if (specialist) {
    doctorFilter.specialist = specialist;
    staffFilter.specialist = specialist;
  }

  const doctors = await Doctor.find(doctorFilter).populate("user_id", "photo is_active").lean();
  const staffList = await Staff.find(staffFilter).populate("user_id", "photo is_active").populate("clinic_id", "name location status geo_location").lean();

  const activeDoctors = doctors.filter((d) => d.user_id?.is_active);
  const activeStaff = staffList.filter((s) => s.user_id?.is_active && s.clinic_id?.status === "approved");

  const combined = await Promise.all([
    ...activeDoctors.map(async (d) => {
      const bookingAgg = await Booking.aggregate([
        { $match: { doctor_id: d._id, status: "confirmed" } },
        { $group: { _id: null, total: { $sum: 1 }, patients: { $addToSet: "$patient_user_id" } } },
      ]);
      const total_bookings = bookingAgg[0]?.total || 0;
      const total_patients = bookingAgg[0]?.patients?.length || 0;
      const ratings = await getRatings({ doctor_id: d._id });
      return {
        provider_type: "doctor", target_id: d._id, doctor_id: d._id, staff_id: null,
        full_name: d.full_name, specialist: d.specialist, work_days: d.work_days,
        work_from: d.work_from, work_to: d.work_to, consultation_price: d.consultation_price,
        location: d.location, photo: d.user_id?.photo, clinic_id: null, clinic_name: null,
        geo_location: formatGeo(d.geo_location),
        total_bookings, total_patients, can_be_booked: true, ...ratings,
      };
    }),
    ...activeStaff.map(async (s) => {
      const bookingAgg = await Booking.aggregate([
        { $match: { staff_id: s._id, status: "confirmed" } },
        { $group: { _id: null, total: { $sum: 1 }, patients: { $addToSet: "$patient_user_id" } } },
      ]);
      const total_bookings = bookingAgg[0]?.total || 0;
      const total_patients = bookingAgg[0]?.patients?.length || 0;
      const ratings = await getRatings({ staff_id: s._id });
      return {
        provider_type: "staff", target_id: s._id, doctor_id: null, staff_id: s._id,
        full_name: s.full_name, specialist: s.specialist, work_days: s.work_days,
        work_from: s.work_from, work_to: s.work_to, consultation_price: s.consultation_price,
        location: s.clinic_id?.location, photo: s.user_id?.photo,
        clinic_id: s.clinic_id?._id, clinic_name: s.clinic_id?.name,
        geo_location: formatGeo(s.clinic_id?.geo_location),
        total_bookings, total_patients, can_be_booked: true, ...ratings,
      };
    }),
  ]);

  combined.sort((a, b) => b.average_rating - a.average_rating || b.total_bookings - a.total_bookings || b.total_patients - a.total_patients || a.full_name.localeCompare(b.full_name));

  res.status(200).json({ status: "success", results: combined.slice(0, limit).length, doctors: combined.slice(0, limit) });
});
