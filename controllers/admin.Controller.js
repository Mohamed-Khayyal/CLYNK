const bcrypt = require("bcryptjs");
const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { createNotification } = require("../utilts/notification");

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

const getAdminUserId = (req, next) => {
  const adminUserId = req.user?.user_id;

  if (!adminUserId) {
    next(new AppError("Admin authentication is required", 401));
    return null;
  }

  return adminUserId;
};

exports.createAdmin = catchAsync(async (req, res, next) => {
  const { email, password, full_name, name } = req.body;
  const adminName = full_name || name;

  if (!email || !password || !adminName) {
    return next(
      new AppError("Name, email, and password are required", 400),
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    return next(new AppError("Invalid email format", 400));
  }

  const exists = await sql.query`
    SELECT user_id FROM dbo.Users WHERE email = ${email};
  `;

  if (exists.recordset.length) {
    return next(new AppError("Email is already in use", 409));
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const transaction = new sql.Transaction(sql.globalConnectionPool);
  let transactionStarted = false;

  try {
    await transaction.begin();
    transactionStarted = true;

    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type)
      OUTPUT INSERTED.user_id
      VALUES (${email}, ${hashedPassword}, 'admin');
    `;

    const userId = userResult.recordset[0].user_id;

    await transaction.request().query`
      INSERT INTO dbo.Admins (user_id, full_name)
      VALUES (${userId}, ${adminName});
    `;

    await transaction.commit();

    res.status(201).json({
      status: "success",
      user: {
        user_id: userId,
        email,
        role: "admin",
      },
    });
  } catch (err) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error(
          "Failed to roll back admin creation transaction:",
          rollbackErr.message,
        );
      }
    }
    next(err);
  }
});

exports.getAllAdmins = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      a.admin_id,
      a.user_id,
      u.email,
      a.full_name,
      u.photo,
      u.is_active,
      u.created_at
    FROM dbo.Admins a
    JOIN dbo.Users u
      ON u.user_id = a.user_id
    ORDER BY a.admin_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    admins: result.recordset,
  });
});

exports.deleteUser = catchAsync(async (req, res, next) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return next(new AppError("Invalid user id", 400));
  }

  if (userId === req.user.user_id) {
    return next(new AppError("You cannot deactivate your own account", 400));
  }

  const user = (
    await sql.query`
      SELECT user_id, email, user_type, is_active
      FROM dbo.Users
      WHERE user_id = ${userId};
    `
  ).recordset[0];

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  if (!user.is_active) {
    return next(new AppError("User is already inactive", 400));
  }

  await sql.query`
    UPDATE dbo.Users
    SET is_active = 0
    WHERE user_id = ${userId};
  `;

  res.status(200).json({
    status: "success",
    message: "User deactivated successfully",
    user: {
      user_id: user.user_id,
      email: user.email,
      role: user.user_type,
      is_active: false,
    },
  });
});

exports.undeleteUser = catchAsync(async (req, res, next) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return next(new AppError("Invalid user id", 400));
  }

  const user = (
    await sql.query`
      SELECT user_id, email, user_type, is_active
      FROM dbo.Users
      WHERE user_id = ${userId};
    `
  ).recordset[0];

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  if (user.is_active) {
    return next(new AppError("User is already active", 400));
  }

  await sql.query`
    UPDATE dbo.Users
    SET is_active = 1
    WHERE user_id = ${userId};
  `;

  res.status(200).json({
    status: "success",
    message: "User reactivated successfully",
    user: {
      user_id: user.user_id,
      email: user.email,
      role: user.user_type,
      is_active: true,
    },
  });
});

exports.getClinics = catchAsync(async (req, res) => {
  const { status } = req.query;

  const result = status
    ? await sql.query`
        SELECT
          c.clinic_id,
          c.name,
          c.email,
          c.phone,
          c.location,
          c.status,
          c.created_at,
          u.email AS owner_email,
          ISNULL(ss.total_staff, 0) AS total_staff,
          ISNULL(r.total_ratings, 0) AS total_ratings,
          CAST(ISNULL(r.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Clinics c
        JOIN dbo.Users u ON c.owner_user_id = u.user_id
        OUTER APPLY (
          SELECT COUNT(*) AS total_staff
          FROM dbo.Staff s
          JOIN dbo.Users su
            ON su.user_id = s.user_id
          WHERE s.clinic_id = c.clinic_id
            AND su.is_active = 1
        ) ss
        OUTER APPLY (
          SELECT
            COUNT(*) AS total_ratings,
            ROUND(AVG(CAST(rt.rating AS FLOAT)), 1) AS average_rating
          FROM dbo.Ratings rt
          WHERE rt.clinic_id = c.clinic_id
        ) r
        WHERE c.status = ${status};
      `
    : await sql.query`
        SELECT
          c.clinic_id,
          c.name,
          c.email,
          c.phone,
          c.location,
          c.status,
          c.created_at,
          u.email AS owner_email,
          ISNULL(ss.total_staff, 0) AS total_staff,
          ISNULL(r.total_ratings, 0) AS total_ratings,
          CAST(ISNULL(r.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating
        FROM dbo.Clinics c
        JOIN dbo.Users u ON c.owner_user_id = u.user_id
        OUTER APPLY (
          SELECT COUNT(*) AS total_staff
          FROM dbo.Staff s
          JOIN dbo.Users su
            ON su.user_id = s.user_id
          WHERE s.clinic_id = c.clinic_id
            AND su.is_active = 1
        ) ss
        OUTER APPLY (
          SELECT
            COUNT(*) AS total_ratings,
            ROUND(AVG(CAST(rt.rating AS FLOAT)), 1) AS average_rating
          FROM dbo.Ratings rt
          WHERE rt.clinic_id = c.clinic_id
        ) r;
      `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    clinics: result.recordset,
  });
});

exports.getPendingClinics = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      c.clinic_id,
      c.name,
      c.email,
      c.phone,
      c.location,
      c.status,
      c.created_at,

      u.email AS owner_email,

      ISNULL(ss.total_staff, 0) AS total_staff,
      ISNULL(r.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(r.average_rating, 0) AS DECIMAL(3,1)) AS average_rating

    FROM dbo.Clinics c

    JOIN dbo.Users u
      ON c.owner_user_id = u.user_id

    OUTER APPLY (
      SELECT COUNT(*) AS total_staff
      FROM dbo.Staff s
      JOIN dbo.Users su
        ON su.user_id = s.user_id
      WHERE s.clinic_id = c.clinic_id
        AND su.is_active = 1
    ) ss

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(rt.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings rt
      WHERE rt.clinic_id = c.clinic_id
    ) r

    WHERE c.status = 'pending'

    ORDER BY c.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    clinics: result.recordset,
  });
});

exports.getApprovedClinics = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      c.clinic_id,
      c.name,
      c.email,
      c.phone,
      c.location,
      c.status,
      c.created_at,

      u.email AS owner_email,

      ISNULL(ss.total_staff, 0) AS total_staff,
      ISNULL(r.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(r.average_rating, 0) AS DECIMAL(3,1)) AS average_rating

    FROM dbo.Clinics c

    JOIN dbo.Users u
      ON c.owner_user_id = u.user_id

    OUTER APPLY (
      SELECT COUNT(*) AS total_staff
      FROM dbo.Staff s
      JOIN dbo.Users su
        ON su.user_id = s.user_id
      WHERE s.clinic_id = c.clinic_id
        AND su.is_active = 1
    ) ss

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(rt.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings rt
      WHERE rt.clinic_id = c.clinic_id
    ) r

    WHERE c.status = 'approved'

    ORDER BY c.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    clinics: result.recordset,
  });
});

exports.approveClinic = catchAsync(async (req, res, next) => {
  const clinicId = Number(req.params.id);
  const adminUserId = getAdminUserId(req, next);

  if (!adminUserId) {
    return;
  }

  if (!clinicId) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const admin = (
    await sql.query`
      SELECT admin_id FROM dbo.Admins WHERE user_id = ${adminUserId};
    `
  ).recordset[0];

  if (!admin) {
    return next(new AppError("Admin privileges are required", 403));
  }

  const clinic = (
    await sql.query`
      SELECT clinic_id, status, owner_user_id
      FROM dbo.Clinics
      WHERE clinic_id = ${clinicId};
    `
  ).recordset[0];

  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  if (clinic.status !== "pending" && clinic.status !== "rejected") {
    return next(
      new AppError("Only clinics with pending status can be approved", 400),
    );
  }

  await sql.query`
    UPDATE dbo.Clinics
    SET
      status = 'approved',
      verified_by_admin_id = ${admin.admin_id},
      verified_at = SYSDATETIME()
    WHERE clinic_id = ${clinicId};
  `;

  await createNotification({
    user_id: clinic.owner_user_id,
    title: "تم اعتماد العيادة",
    message: "تم اعتماد عيادتك وأصبحت متاحة الآن.",
  });

  res.status(200).json({
    status: "success",
    message: "تم اعتماد العيادة بنجاح",
  });
});

exports.rejectClinic = catchAsync(async (req, res, next) => {
  const clinicId = Number(req.params.id);
  const adminUserId = getAdminUserId(req, next);

  if (!adminUserId) return;

  if (!Number.isInteger(clinicId) || clinicId <= 0) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const admin = (
    await sql.query`
      SELECT admin_id
      FROM dbo.Admins
      WHERE user_id = ${adminUserId};
    `
  ).recordset[0];

  if (!admin) {
    return next(new AppError("Admin privileges required", 403));
  }

  const clinic = (
    await sql.query`
      SELECT clinic_id,status,owner_user_id
      FROM dbo.Clinics
      WHERE clinic_id = ${clinicId};
    `
  ).recordset[0];

  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  if (clinic.status !== "pending" && clinic.status !== "approved") {
    return next(
      new AppError("Only pending or approved clinics can be rejected", 400),
    );
  }

  await sql.query`
    UPDATE dbo.Clinics
    SET
      status='rejected',
      verified_by_admin_id=NULL,
      verified_at=NULL
    WHERE clinic_id=${clinicId};
  `;

  await createNotification({
    user_id: clinic.owner_user_id,
    title: "تم رفض العيادة",
    message:
      "تم رفض طلب التحقق من العيادة، يرجى مراجعة البيانات وإعادة التقديم.",
  });

  res.status(200).json({
    status: "success",
    message: "Clinic rejected successfully",
  });
});

exports.unverifyClinic = catchAsync(async (req, res, next) => {
  const clinicId = Number(req.params.id);
  const adminUserId = getAdminUserId(req, next);

  if (!adminUserId) return;

  if (!Number.isInteger(clinicId) || clinicId <= 0) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const admin = (
    await sql.query`
      SELECT admin_id
      FROM dbo.Admins
      WHERE user_id=${adminUserId};
    `
  ).recordset[0];

  if (!admin) {
    return next(new AppError("Admin privileges required", 403));
  }

  const clinic = (
    await sql.query`
      SELECT clinic_id,status,owner_user_id
      FROM dbo.Clinics
      WHERE clinic_id=${clinicId};
    `
  ).recordset[0];

  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  if (clinic.status !== "approved" && clinic.status !== "rejected") {
    return next(
      new AppError("Only approved or rejected clinics can be unverified", 400),
    );
  }

  await sql.query`
    UPDATE dbo.Clinics
    SET
      status='pending',
      verified_by_admin_id=NULL,
      verified_at=NULL
    WHERE clinic_id=${clinicId};
  `;

  await createNotification({
    user_id: clinic.owner_user_id,
    title: "تم إلغاء التحقق من العيادة",
    message: "تم إلغاء اعتماد العيادة وعادت للمراجعة مرة أخرى.",
  });

  res.status(200).json({
    status: "success",
    message: "Clinic unverified successfully",
  });
});

exports.getAllDoctors = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      d.doctor_id,
      phone,
      d.user_id,
      u.email,
      d.full_name,
      d.gender,
      d.years_of_experience,
      d.bio,
      d.consultation_price,
      CONVERT(VARCHAR(5), d.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), d.work_to, 108)   AS work_to,
      d.work_days,
      d.specialist,
      d.location,
      d.is_verified,
      u.photo,
      u.is_active,

      ISNULL(bs.total_bookings, 0) AS total_bookings,
      ISNULL(bs.total_patients, 0) AS total_patients,
      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3,1)) AS average_rating

    FROM dbo.Doctors d

    JOIN dbo.Users u
      ON d.user_id = u.user_id

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT b.patient_user_id) AS total_patients
      FROM dbo.Bookings b
      WHERE b.doctor_id = d.doctor_id
        AND b.status = 'confirmed'
    ) bs

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = d.doctor_id
    ) rs

    ORDER BY u.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: result.recordset,
  });
});

exports.getVerifiedDoctors = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      d.doctor_id,
      d.user_id,
      u.email,
      d.full_name,
      d.gender,
      d.years_of_experience,
      d.bio,
      d.consultation_price,
      CONVERT(VARCHAR(5), d.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), d.work_to, 108)   AS work_to,
      d.work_days,
      d.specialist,
      d.location,
      d.is_verified,
      u.photo,
      u.is_active,
      ISNULL(bs.total_bookings, 0) AS total_bookings,
      ISNULL(bs.total_patients, 0) AS total_patients,
      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3, 1)) AS average_rating

    FROM dbo.Doctors d

    JOIN dbo.Users u
      ON d.user_id = u.user_id

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(DISTINCT b.patient_user_id) AS total_patients
      FROM dbo.Bookings b
      WHERE b.doctor_id = d.doctor_id
        AND b.status = 'confirmed'
    ) bs

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = d.doctor_id
    ) rs

    WHERE
      d.is_verified = 1
    ORDER BY
      ISNULL(bs.total_bookings, 0) DESC,
      u.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: result.recordset,
  });
});

exports.getUnverifiedDoctors = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      d.doctor_id,
      d.user_id,
      u.email,
      d.full_name,
      d.gender,
      d.years_of_experience,
      d.bio,
      d.consultation_price,
      CONVERT(VARCHAR(5), d.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), d.work_to, 108)   AS work_to,
      d.work_days,
      d.specialist,
      d.location,
      d.is_verified,
      u.photo,
      u.is_active,

      ISNULL(rs.total_ratings, 0) AS total_ratings,
      CAST(ISNULL(rs.average_rating, 0) AS DECIMAL(3,1)) AS average_rating

    FROM dbo.Doctors d

    JOIN dbo.Users u
      ON d.user_id = u.user_id

    OUTER APPLY (
      SELECT
        COUNT(*) AS total_ratings,
        ROUND(AVG(CAST(r.rating AS FLOAT)), 1) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = d.doctor_id
    ) rs

    WHERE d.is_verified = 0

    ORDER BY u.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    doctors: result.recordset,
  });
});

exports.verifyDoctor = catchAsync(async (req, res, next) => {
  const doctorId = Number(req.params.id);
  const adminUserId = getAdminUserId(req, next);

  if (!adminUserId) {
    return;
  }

  if (!doctorId) {
    return next(new AppError("Invalid doctor id", 400));
  }

  const admin = (
    await sql.query`
      SELECT admin_id FROM dbo.Admins WHERE user_id = ${adminUserId};
    `
  ).recordset[0];

  if (!admin) {
    return next(new AppError("Admin privileges are required", 403));
  }

  const doctor = (
    await sql.query`
      SELECT doctor_id, user_id, is_verified
      FROM dbo.Doctors
      WHERE doctor_id = ${doctorId};
    `
  ).recordset[0];

  if (!doctor) {
    return next(new AppError("Doctor not found", 404));
  }

  if (doctor.is_verified) {
    return next(new AppError("Doctor is already verified", 400));
  }

  await sql.query`
    UPDATE dbo.Doctors
    SET is_verified = 1
    WHERE doctor_id = ${doctorId};
  `;

  await createNotification({
    user_id: doctor.user_id,
    title: "تم توثيق حساب الطبيب",
    message: "تم توثيق حسابك كطبيب. يمكنك الآن استقبال الحجوزات.",
  });

  res.status(200).json({
    status: "success",
    message: "تم توثيق الطبيب بنجاح",
  });
});

exports.unverifyDoctor = catchAsync(async (req, res, next) => {
  const doctorId = Number(req.params.id);
  const adminUserId = getAdminUserId(req, next);

  if (!adminUserId) {
    return;
  }

  if (!doctorId) {
    return next(new AppError("Invalid doctor id", 400));
  }

  const admin = (
    await sql.query`
      SELECT admin_id FROM dbo.Admins WHERE user_id = ${adminUserId};
    `
  ).recordset[0];

  if (!admin) {
    return next(new AppError("Admin privileges are required", 403));
  }

  const doctor = (
    await sql.query`
      SELECT doctor_id, user_id, is_verified
      FROM dbo.Doctors
      WHERE doctor_id = ${doctorId};
    `
  ).recordset[0];

  if (!doctor) {
    return next(new AppError("Doctor not found", 404));
  }

  if (!doctor.is_verified) {
    return next(new AppError("Doctor is already unverified", 400));
  }

  await sql.query`
    UPDATE dbo.Doctors
    SET is_verified = 0
    WHERE doctor_id = ${doctorId};
  `;

  await createNotification({
    user_id: doctor.user_id,
    title: "تم إلغاء توثيق حساب الطبيب",
    message: "تم إلغاء توثيق حسابك كطبيب. يرجى التواصل مع الدعم للمساعدة.",
  });

  res.status(200).json({
    status: "success",
    message: "تم إلغاء توثيق الطبيب بنجاح",
  });
});

exports.getAllStaff = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      s.staff_id,
      s.user_id,
      u.email,
      s.full_name,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      s.is_verified,
      u.is_active,
      u.photo,
      c.clinic_id,
      c.name AS clinic_name,
      c.status AS clinic_status,
      c.location AS clinic_location,
      c.owner_user_id,
      owner_u.email AS clinic_owner_email
    FROM dbo.Staff s
    JOIN dbo.Users u
      ON u.user_id = s.user_id
    JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id
    JOIN dbo.Users owner_u
      ON owner_u.user_id = c.owner_user_id
    ORDER BY c.clinic_id DESC, s.staff_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    staff: result.recordset,
  });
});

exports.getAllPatients = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      p.patient_id,
      p.user_id,
      u.email,
      p.full_name,
      p.phone,
      p.gender,
      u.is_active,
      u.photo,
      ISNULL(pb.total_bookings, 0) AS total_bookings,
      ISNULL(pb.upcoming_bookings, 0) AS upcoming_bookings
    FROM dbo.Patients p
    JOIN dbo.Users u
      ON u.user_id = p.user_id
    OUTER APPLY (
      SELECT
        COUNT(*) AS total_bookings,
        COUNT(CASE WHEN b.booking_date >= CAST(GETDATE() AS DATE) THEN 1 END) AS upcoming_bookings
      FROM dbo.Bookings b
      WHERE b.patient_user_id = p.user_id
    ) pb
    ORDER BY p.patient_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    patients: result.recordset,
  });
});

exports.getVerifiedStaff = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      s.staff_id,
      s.user_id,
      u.email,
      s.full_name,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      s.is_verified,
      u.is_active,
      u.zphoto,

      c.clinic_id,
      c.name AS clinic_name,
      c.status AS clinic_status,
      c.location AS clinic_location

    FROM dbo.Staff s
    JOIN dbo.Users u
      ON u.user_id = s.user_id
    JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id

    WHERE s.is_verified = 1

    ORDER BY s.staff_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    staff: result.recordset,
  });
});

exports.getUnverifiedStaff = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      s.staff_id,
      s.user_id,
      u.email,
      s.full_name,
      s.specialist,
      s.work_days,
      CONVERT(VARCHAR(5), s.work_from, 108) AS work_from,
      CONVERT(VARCHAR(5), s.work_to, 108)   AS work_to,
      s.consultation_price,
      s.is_verified,
      u.is_active,
      u.photo,

      c.clinic_id,
      c.name AS clinic_name,
      c.status AS clinic_status,
      c.location AS clinic_location

    FROM dbo.Staff s
    JOIN dbo.Users u
      ON u.user_id = s.user_id
    JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id

    WHERE s.is_verified = 0

    ORDER BY s.staff_id DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    staff: result.recordset,
  });
});

exports.getAllBookings = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      b.booking_id,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to, 108) AS booking_to,
      CONCAT(
        CONVERT(VARCHAR(10), b.booking_date, 120),
        ' ',
        CONVERT(VARCHAR(5), b.booking_from, 108)
      ) AS date_time,
      b.status,

      COALESCE(d.full_name, s.full_name) AS doctor_name,
      CASE
        WHEN b.staff_id IS NOT NULL THEN N'عيادة'
        ELSE N'طبيب'
      END AS session_type,

      p.patient_id,
      p.full_name AS patient_name,
      p.phone AS patient_number,

      c.clinic_id,
      c.name AS clinic_name

    FROM dbo.Bookings b

    JOIN dbo.Patients p
      ON p.user_id = b.patient_user_id

    LEFT JOIN dbo.Doctors d
      ON d.doctor_id = b.doctor_id

    LEFT JOIN dbo.Staff s
      ON s.staff_id = b.staff_id

    LEFT JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id

    ORDER BY b.booking_date DESC, b.booking_from DESC, b.created_at DESC;
  `;

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    bookings: result.recordset,
  });
});

exports.adminStats = catchAsync(async (req, res) => {
  const doctorsQuery = await sql.query(`
      SELECT COUNT(*) AS count
      FROM dbo.Doctors
  `);

  const staffQuery = await sql.query(`
      SELECT COUNT(*) AS count
      FROM dbo.Staff
  `);

  const clinicsQuery = await sql.query(`
      SELECT COUNT(*) AS count
      FROM dbo.Clinics
  `);

  const patientsQuery = await sql.query(`
      SELECT COUNT(*) AS count
      FROM dbo.Patients
  `);

  const [doctors, staff, clinics, patients] = await Promise.all([
    doctorsQuery,
    staffQuery,
    clinicsQuery,
    patientsQuery,
  ]);

  const totalDoctors = doctors.recordset[0].count;

  const totalStaff = staff.recordset[0].count;

  const totalClinics = clinics.recordset[0].count;

  const totalPatients = patients.recordset[0].count;

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
