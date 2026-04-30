const bcrypt = require("bcryptjs");
const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { createNotification } = require("../utilts/notification");
const Email = require("../utilts/email");

const ALLOWED_STAFF_ROLES = new Set(["doctor", "nurse", "receptionist"]);
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const sendStaffDoctorPendingVerificationEmail = async ({ email, full_name }) => {
  try {
    await new Email({
      email,
      name: full_name || email,
    }).sendDoctorPendingVerification();
  } catch (err) {
    console.error("Failed to send staff doctor pending verification email:", err.message);
  }
};

exports.createStaffForClinic = catchAsync(async (req, res, next) => {
  const {
    email,
    password,
    full_name,
    role_title,
    specialist,
    work_days,
    work_from,
    work_to,
    consultation_price,
  } = req.body;
  const { clinic_id, owner_user_id } = req.clinic;

  if (!email || !password || !full_name || !role_title) {
    return next(
      new AppError(
        "Email, password, full_name, and role_title are required",
        400,
      ),
    );
  }

  if (!ALLOWED_STAFF_ROLES.has(role_title)) {
    return next(new AppError("Invalid role_title value", 400));
  }

  const exists = await sql.query`
    SELECT user_id FROM dbo.Users WHERE email = ${email};
  `;
  if (exists.recordset.length) {
    return next(new AppError("Email is already in use", 409));
  }

  const isDoctor = role_title === "doctor";
  const normalizedWorkDays = Array.isArray(work_days)
    ? work_days.join(",")
    : work_days;
  const normalizedPrice = Number(consultation_price);

  if (isDoctor) {
    if (!specialist) {
      return next(
        new AppError("specialist is required when role_title is doctor", 400),
      );
    }

    if (!normalizedWorkDays || !work_from || !work_to) {
      return next(
        new AppError(
          "work_days, work_from, and work_to are required for staff doctors",
          400,
        ),
      );
    }

    if (!TIME_REGEX.test(work_from) || !TIME_REGEX.test(work_to)) {
      return next(new AppError("Invalid work time format", 400));
    }

    if (Number.isNaN(normalizedPrice) || normalizedPrice < 0) {
      return next(
        new AppError("consultation_price must be a valid non-negative number", 400),
      );
    }
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const transaction = new sql.Transaction(sql.globalConnectionPool);
  let transactionStarted = false;
  let userId;

  try {
    await transaction.begin();
    transactionStarted = true;

    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type)
      OUTPUT INSERTED.user_id
      VALUES (${email}, ${hashedPassword}, 'staff');
    `;

    userId = userResult.recordset[0].user_id;

    await transaction.request().query`
      INSERT INTO dbo.Staff
        (user_id,
         clinic_id,
         full_name,
         role_title,
         specialist,
         work_days,
         work_from,
         work_to,
         consultation_price,
         is_verified)
      VALUES
        (${userId},
         ${clinic_id},
         ${full_name},
         ${role_title},
         ${isDoctor ? specialist : null},
         ${isDoctor ? normalizedWorkDays : null},
         ${isDoctor ? work_from : null},
         ${isDoctor ? work_to : null},
         ${isDoctor ? normalizedPrice : null},
         0);
    `;

    await transaction.commit();
  } catch (err) {
    if (transactionStarted) {
      await transaction.rollback();
    }
    return next(err);
  }

  if (owner_user_id) {
    await createNotification({
      user_id: owner_user_id,
      title: "توثيق الموظف قيد الانتظار",
      message: `تم إنشاء حساب موظف باسم "${full_name}" وهو بانتظار التوثيق.`,
    });
  }

  if (isDoctor) {
    await sendStaffDoctorPendingVerificationEmail({ email, full_name });
  }

  res.status(201).json({
    status: "success",
    staff: {
      user_id: userId,
      email,
      full_name,
      role_title,
      specialist: isDoctor ? specialist : null,
      work_days: isDoctor ? normalizedWorkDays : null,
      work_from: isDoctor ? work_from : null,
      work_to: isDoctor ? work_to : null,
      consultation_price: isDoctor ? normalizedPrice : null,
      clinic_id,
      is_verified: false,
    },
  });
});

exports.getMyClinicStaff = catchAsync(async (req, res) => {
  const { clinic_id } = req.clinic;

  const staffResult = await sql.query`
    SELECT
      s.staff_id,
      u.email,
      s.full_name,
      s.role_title,
      s.specialist,
      s.is_verified,
      u.is_active,
      u.photo
    FROM dbo.Staff s
    JOIN dbo.Users u
      ON s.user_id = u.user_id
    WHERE s.clinic_id = ${clinic_id}
    ORDER BY s.staff_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: staffResult.recordset.length,
    staff: staffResult.recordset,
  });
});

exports.verifyStaff = catchAsync(async (req, res, next) => {
  const staffId = Number(req.params.staffId);
  const { clinic_id } = req.clinic;

  const staffResult = await sql.query`
    SELECT staff_id, user_id, is_verified
    FROM dbo.Staff
    WHERE staff_id = ${staffId}
      AND clinic_id = ${clinic_id};
  `;

  const staff = staffResult.recordset[0];
  if (!staff) {
    return next(new AppError("Staff member is not part of your clinic", 404));
  }

  if (staff.is_verified) {
    return next(new AppError("Staff member is already verified", 400));
  }

  await sql.query`
    UPDATE dbo.Staff
    SET is_verified = 1
    WHERE staff_id = ${staffId};
  `;

  await createNotification({
    user_id: staff.user_id,
    title: "تم توثيق حساب الموظف",
    message:
      "تم توثيق حسابك كموظف. يمكنك الآن الوصول إلى ميزات العيادة.",
  });

  res.status(200).json({
    status: "success",
    message: "Staff member verified successfully",
    staff_id: staffId,
  });
});

exports.getPendingStaff = catchAsync(async (req, res) => {
  const { clinic_id } = req.clinic;

  const result = await sql.query`
    SELECT
      s.staff_id,
      s.full_name,
      s.role_title,
      s.specialist,
      u.email,
      u.photo,
      u.created_at
    FROM dbo.Staff s
    JOIN dbo.Users u
      ON s.user_id = u.user_id
    WHERE s.clinic_id = ${clinic_id}
      AND s.is_verified = 0
    ORDER BY u.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    staff: result.recordset,
  });
});

exports.getStaffProfile = catchAsync(async (req, res, next) => {
  const staffId = Number(req.params.id);

  if (!Number.isInteger(staffId) || staffId <= 0) {
    return next(new AppError("Invalid staff id", 400));
  }

  const staff = await sql.query`
    SELECT
      s.staff_id,
      s.user_id,
      s.full_name,
      s.role_title,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      s.is_verified,
      u.photo,
      c.clinic_id,
      c.name AS clinic_name,
      c.location AS clinic_location,
      c.phone AS clinic_phone,
      ISNULL(bs.total_bookings, 0) AS total_bookings,
      ISNULL(bs.total_patients, 0) AS total_patients,
      ISNULL(cr.total_ratings, 0) AS clinic_total_ratings,
      CAST(ISNULL(cr.average_rating, 0) AS DECIMAL(3, 1)) AS clinic_average_rating,
      CAST(1 AS BIT) AS can_be_booked
    FROM dbo.Staff s
    JOIN dbo.Users u
      ON u.user_id = s.user_id
    JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id
    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT b.patient_user_id) AS total_patients
      FROM dbo.Bookings b
      WHERE b.staff_id = s.staff_id
        AND b.status = 'confirmed'
    ) bs
    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.clinic_id = c.clinic_id
    ) cr
    WHERE s.staff_id = ${staffId}
      AND s.role_title = 'doctor'
      AND s.is_verified = 1
      AND u.is_active = 1
      AND c.status = 'approved';
  `;

  if (!staff.recordset.length) {
    return next(new AppError("Staff doctor not found or unavailable for booking", 404));
  }

  res.status(200).json({
    status: "success",
    staff: staff.recordset[0],
  });
});
