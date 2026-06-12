const bcrypt = require("bcryptjs");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { normalizeGeoLocation, getGeoLocationFromBody } = require("../utilts/geo.Location");


const User = require("../models/User.model");
const Doctor = require("../models/Doctor.model");
const Patient = require("../models/Patient.model");
const Clinic = require("../models/Clinic.model");
const Staff = require("../models/Staff.model");
const Admin = require("../models/Admin.model");
const Rating = require("../models/Rating.model");

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const v = value.trim();
    return v === "" ? null : v;
  }
  return value;
};

const NAME_REGEX = /^[\p{L}\s.'-]{2,150}$/u;
const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const getRatings = async ({ doctor_id, staff_id }) => {
  const matchField = doctor_id ? { doctor_id } : { staff_id };
  const agg = await Rating.aggregate([
    { $match: matchField },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: "$rating" } } },
  ]);
  if (!agg.length) return { total_ratings: 0, average_rating: 0 };
  return { total_ratings: agg[0].total, average_rating: Math.round(agg[0].avg * 10) / 10 };
};

const buildGeoField = (geo_location) => {
  const normalized = normalizeGeoLocation(geo_location);
  if (!normalized) return null;
  return { type: "Point", coordinates: [normalized.longitude, normalized.latitude] };
};

const formatGeo = (geo_location) => {
  if (!geo_location || !geo_location.coordinates || geo_location.coordinates.length !== 2) return null;
  return { latitude: geo_location.coordinates[1], longitude: geo_location.coordinates[0] };
};

exports.getMe = catchAsync(async (req, res, next) => {
  const { user_id, user_type } = req.user;

  const user = await User.findById(user_id).lean();
  if (!user) return next(new AppError("User not found", 404));

  let profile = null;

  if (user_type === "patient") {
    const patient = await Patient.findOne({ user_id }).lean();
    if (patient) {
      profile = {
        patient_id: patient._id,
        full_name: patient.full_name,
        date_of_birth: patient.date_of_birth ? new Date(patient.date_of_birth).toISOString().slice(0, 10) : null,
        gender: patient.gender,
        phone: patient.phone,
      };
    }
  } else if (user_type === "doctor") {
    const doctor = await Doctor.findOne({ user_id }).lean();
    if (doctor) {
      const ratings = await getRatings({ doctor_id: doctor._id });
      profile = {
        doctor_id: doctor._id,
        full_name: doctor.full_name,
        phone: doctor.phone,
        gender: doctor.gender,
        years_of_experience: doctor.years_of_experience,
        bio: doctor.bio,
        consultation_price: doctor.consultation_price,
        work_from: doctor.work_from,
        work_to: doctor.work_to,
        specialist: doctor.specialist,
        work_days: doctor.work_days,
        location: doctor.location,
        geo_location: formatGeo(doctor.geo_location),
        is_verified: doctor.is_verified,
        licence: doctor.licence,
        ...ratings,
      };
    }
  } else if (user_type === "staff") {
    const staff = await Staff.findOne({ user_id }).populate("clinic_id", "name location geo_location").lean();
    if (staff) {
      const ratings = await getRatings({ staff_id: staff._id });
      profile = {
        staff_id: staff._id,
        full_name: staff.full_name,
        years_of_experience: staff.years_of_experience,
        bio: staff.bio,
        gender: staff.gender,
        specialist: staff.specialist,
        work_days: staff.work_days,
        work_from: staff.work_from,
        work_to: staff.work_to,
        consultation_price: staff.consultation_price,
        phone: staff.phone,
        location: staff.location,
        geo_location: formatGeo(staff.geo_location),
        is_verified: staff.is_verified,
        clinic_id: staff.clinic_id?._id || null,
        licence: staff.licence,
        clinic_name: staff.clinic_id?.name || null,
        clinic_location: staff.clinic_id?.location || null,
        clinic_geo_location: formatGeo(staff.clinic_id?.geo_location),
        ...ratings,
      };
    }
  } else if (user_type === "clinic") {
    const clinic = await Clinic.findOne({ owner_user_id: user_id }).lean();
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
        geo_location: formatGeo(clinic.geo_location),
      };
    }
  } else if (user_type === "admin") {
    const admin = await Admin.findOne({ user_id }).lean();
    if (admin) profile = { admin_id: admin._id, full_name: admin.full_name };
  }

  res.status(200).json({
    status: "success",
    user: {
      user_id,
      email: user.email,
      role: user_type,
      is_active: user.is_active,
      photo: user.photo,
      profile,
    },
  });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { user_id, user_type } = req.user;
  const data = { ...req.body };

  if (!data || Object.keys(data).length === 0) {
    return next(new AppError("No update data was provided", 400));
  }

  let photo;
  if (data.photo) {
    await User.findByIdAndUpdate(user_id, { photo: data.photo });
    photo = data.photo;
  } else {
    const current = await User.findById(user_id).select("photo").lean();
    photo = current?.photo || null;
  }

  if (user_type === "patient") {
    let { full_name, date_of_birth, gender, phone } = data;
    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) return next(new AppError("Invalid full_name value", 400));

    const update = {};
    if (full_name) update.full_name = full_name;
    if (normalize(date_of_birth)) update.date_of_birth = normalize(date_of_birth);
    if (normalize(gender)) update.gender = normalize(gender);
    if (normalize(phone)) update.phone = normalize(phone);

    const updated = await Patient.findOneAndUpdate({ user_id }, update, { new: true }).lean();
    if (!updated) return next(new AppError("Profile not found", 404));

    return res.status(200).json({
      status: "success",
      message: "تم تحديث الملف الشخصي بنجاح",
      photo,
      profile: {
        full_name: updated.full_name,
        date_of_birth: updated.date_of_birth ? new Date(updated.date_of_birth).toISOString().slice(0, 10) : null,
        gender: updated.gender,
        phone: updated.phone,
      },
    });
  }

  if (user_type === "doctor") {
    let { full_name, gender, years_of_experience, bio, consultation_price, phone, work_from, work_to, specialist, work_days, location, licence } = data;
    const doctorGeoLocation = normalizeGeoLocation(getGeoLocationFromBody(data));

    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) return next(new AppError("Invalid full_name value", 400));
    if (work_from && !TIME_REGEX.test(work_from)) return next(new AppError("Invalid work_from format", 400));
    if (work_to && !TIME_REGEX.test(work_to)) return next(new AppError("Invalid work_to format", 400));
    if (Array.isArray(work_days)) work_days = work_days.join(",");

    const update = {};
    if (full_name) update.full_name = full_name;
    if (normalize(gender)) update.gender = normalize(gender);
    if (normalize(years_of_experience) !== null) update.years_of_experience = normalize(years_of_experience);
    if (normalize(bio) !== null) update.bio = normalize(bio);
    if (normalize(consultation_price) !== null) update.consultation_price = normalize(consultation_price);
    if (normalize(phone) !== null) update.phone = normalize(phone);
    if (normalize(work_from) !== null) update.work_from = normalize(work_from);
    if (normalize(work_to) !== null) update.work_to = normalize(work_to);
    // specialist cannot be updated
    if (normalize(work_days) !== null) update.work_days = normalize(work_days);
    if (normalize(location) !== null) update.location = normalize(location);
    if (normalize(licence) !== null) update.licence = normalize(licence);
    if (doctorGeoLocation !== undefined) {
      update.geo_location = doctorGeoLocation
        ? { type: "Point", coordinates: [doctorGeoLocation.longitude, doctorGeoLocation.latitude] }
        : null;
    }

    const updated = await Doctor.findOneAndUpdate({ user_id }, update, { new: true }).lean();
    if (!updated) return next(new AppError("Profile not found", 404));

    const ratings = await getRatings({ doctor_id: updated._id });

    return res.status(200).json({
      status: "success",
      message: "تم تحديث الملف الشخصي بنجاح",
      photo,
      profile: {
        full_name: updated.full_name,
        gender: updated.gender,
        years_of_experience: updated.years_of_experience,
        bio: updated.bio,
        consultation_price: updated.consultation_price,
        phone: updated.phone,
        work_from: updated.work_from,
        work_to: updated.work_to,
        specialist: updated.specialist,
        work_days: updated.work_days,
        location: updated.location,
        geo_location: formatGeo(updated.geo_location),
        is_verified: updated.is_verified,
        licence: updated.licence,
        ...ratings,
      },
    });
  }

  if (user_type === "staff") {
    const staff = await Staff.findOne({ user_id }).lean();
    if (!staff) return next(new AppError("Profile not found", 404));

    let { full_name, gender, years_of_experience, bio, specialist, work_days, work_from, work_to, consultation_price, phone, location, licence } = data;
    const staffGeoLocation = normalizeGeoLocation(getGeoLocationFromBody(data));

    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) return next(new AppError("Invalid full_name value", 400));
    if (work_from && !TIME_REGEX.test(work_from)) return next(new AppError("Invalid work_from format", 400));
    if (work_to && !TIME_REGEX.test(work_to)) return next(new AppError("Invalid work_to format", 400));
    if (Array.isArray(work_days)) work_days = work_days.join(",");

    const update = {};
    if (full_name) update.full_name = full_name;
    if (normalize(gender) !== null) update.gender = normalize(gender);
    if (normalize(years_of_experience) !== null) update.years_of_experience = normalize(years_of_experience);
    if (normalize(bio) !== null) update.bio = normalize(bio);
    if (normalize(phone) !== null) update.phone = normalize(phone);
    // specialist cannot be updated
    if (normalize(work_days) !== null) update.work_days = normalize(work_days);
    if (normalize(work_from) !== null) update.work_from = normalize(work_from);
    if (normalize(work_to) !== null) update.work_to = normalize(work_to);
    if (normalize(consultation_price) !== null) update.consultation_price = normalize(consultation_price);
    if (normalize(location) !== null) update.location = normalize(location);
    if (normalize(licence) !== null) update.licence = normalize(licence);
    if (staffGeoLocation !== undefined) {
      update.geo_location = staffGeoLocation
        ? { type: "Point", coordinates: [staffGeoLocation.longitude, staffGeoLocation.latitude] }
        : null;
    }

    const updated = await Staff.findOneAndUpdate({ user_id }, update, { new: true }).lean();
    if (!updated) return next(new AppError("Profile not found", 404));

    return res.status(200).json({
      status: "success",
      message: "تم تحديث الملف الشخصي بنجاح",
      photo,
      profile: {
        full_name: updated.full_name,
        gender: updated.gender,
        years_of_experience: updated.years_of_experience,
        bio: updated.bio,
        phone: updated.phone,
        specialist: updated.specialist,
        work_days: updated.work_days,
        consultation_price: updated.consultation_price,
        location: updated.location,
        work_from: updated.work_from,
        work_to: updated.work_to,
        geo_location: formatGeo(updated.geo_location),
        clinic_id: updated.clinic_id,
        is_verified: updated.is_verified,
        licence: updated.licence,
      },
    });
  }

  if (user_type === "clinic") {
    let { name, address, location, phone, email, licence } = data;
    const clinicGeoLocation = normalizeGeoLocation(getGeoLocationFromBody(data));

    name = normalize(name);
    if (name && (typeof name !== "string" || name.length > 150)) return next(new AppError("Invalid clinic name value", 400));

    email = normalize(email);
    if (email && !EMAIL_REGEX.test(email)) return next(new AppError("Invalid email format", 400));

    if (email) {
      const duplicate = await User.findOne({ email, _id: { $ne: user_id } }).lean()
        || await Clinic.findOne({ email, owner_user_id: { $ne: user_id } }).lean();
      if (duplicate) return next(new AppError("Email is already in use", 409));
    }

    if (email) await User.findByIdAndUpdate(user_id, { email });

    const clinicUpdate = {
      status: "pending",
      verified_at: null,
      verified_by_admin_id: null,
    };
    if (name) clinicUpdate.name = name;
    if (normalize(address)) clinicUpdate.address = normalize(address);
    if (normalize(location)) clinicUpdate.location = normalize(location);
    if (normalize(phone)) clinicUpdate.phone = normalize(phone);
    if (email) clinicUpdate.email = email;
    if (normalize(licence)) clinicUpdate.licence = normalize(licence);
    if (clinicGeoLocation !== undefined) {
      clinicUpdate.geo_location = clinicGeoLocation
        ? { type: "Point", coordinates: [clinicGeoLocation.longitude, clinicGeoLocation.latitude] }
        : null;
    }

    const updated = await Clinic.findOneAndUpdate({ owner_user_id: user_id }, clinicUpdate, { new: true }).lean();
    if (!updated) return next(new AppError("Profile not found", 404));

    return res.status(200).json({
      status: "success",
      message: "تم تحديث الملف الشخصي بنجاح",
      photo,
      profile: {
        clinic_id: updated._id,
        name: updated.name,
        address: updated.address,
        location: updated.location,
        phone: updated.phone,
        email: updated.email,
        status: updated.status,
        licence: updated.licence,
        geo_location: formatGeo(updated.geo_location),
      },
    });
  }

  if (user_type === "admin") {
    let { full_name } = data;
    full_name = normalize(full_name);
    if (full_name && !NAME_REGEX.test(full_name)) return next(new AppError("Invalid full_name value", 400));
    if (!full_name && !data.photo) return next(new AppError("Admin can update only full_name or photo", 400));

    let profile = null;
    if (full_name) {
      const updated = await Admin.findOneAndUpdate({ user_id }, { full_name }, { new: true }).lean();
      if (!updated) return next(new AppError("Profile not found", 404));
      profile = { full_name: updated.full_name };
    } else {
      const admin = await Admin.findOne({ user_id }).lean();
      profile = admin ? { full_name: admin.full_name } : null;
    }

    return res.status(200).json({
      status: "success",
      message: "تم تحديث الملف الشخصي بنجاح",
      photo,
      profile,
    });
  }

  return next(new AppError("Profile update is not allowed", 403));
});

exports.userStats = catchAsync(async (req, res) => {
  const [totalDoctors, totalStaff, totalClinics, totalPatients] = await Promise.all([
    Doctor.countDocuments({ is_verified: true }),
    Staff.countDocuments({ is_verified: true }),
    Clinic.countDocuments({ status: "approved" }),
    Patient.countDocuments(),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      totalDoctors,
      totalStaff,
      totalClinics,
      totalPatients,
      totalMedicalUsers: totalDoctors + totalStaff,
    },
  });
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const { user_id } = req.user;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return next(new AppError("يجب توفير كلمة المرور الحالية وكلمة المرور الجديدة", 400));
  }

  if (new_password.length < 8) {
    return next(new AppError("يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل", 400));
  }

  if (new_password !== confirm_password) {
    return next(new AppError("كلمة المرور الجديدة وتأكيدها غير متطابقتين", 400));
  }

  // Fetch user WITH password (select it back since it is normally excluded)
  const user = await User.findById(user_id).select("+password");
  if (!user) return next(new AppError("المستخدم غير موجود", 404));

  const isMatch = await bcrypt.compare(current_password, user.password);
  if (!isMatch) {
    return next(new AppError("كلمة المرور الحالية غير صحيحة", 401));
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const hashed = await bcrypt.hash(new_password, saltRounds);

  await User.findByIdAndUpdate(user_id, { password: hashed });

  res.status(200).json({
    status: "success",
    message: "تم تغيير كلمة المرور بنجاح",
  });
});
