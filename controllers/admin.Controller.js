const bcrypt = require("bcryptjs");
const { sql } = require("../config/db.Config");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { createNotification } = require("../utilts/notification");

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

exports.createAdmin = catchAsync(async (req, res, next) => {
  const { email, password, full_name } = req.body;

  if (!email || !password || !full_name) {
    return next(
      new AppError("Email, password, and full_name are required", 400),
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
      VALUES (${userId}, ${full_name});
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
        console.error("Failed to roll back admin creation transaction:", rollbackErr.message);
      }
    }
    next(err);
  }
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
  const adminUserId = req.user.user_id;

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

  if (clinic.status !== "pending") {
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
  const adminUserId = req.user.user_id;

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

  if (clinic.status !== "pending") {
    return next(
      new AppError("Only clinics with pending status can be rejected", 400),
    );
  }

  await sql.query`
    UPDATE dbo.Clinics
    SET
      status = 'rejected',
      verified_by_admin_id = ${admin.admin_id},
      verified_at = SYSDATETIME()
    WHERE clinic_id = ${clinicId};
  `;

  await createNotification({
    user_id: clinic.owner_user_id,
    title: "تم رفض العيادة",
    message: "تم رفض طلب العيادة. يرجى مراجعة المتطلبات وإعادة التقديم.",
  });

  res.status(200).json({
    status: "success",
    message: "تم رفض العيادة بنجاح",
  });
});

exports.getAllDoctors = catchAsync(async (req, res) => {
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

    LEFT JOIN dbo.Clinics c
      ON c.owner_user_id = d.user_id
     AND c.status = 'approved'

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
      AND c.clinic_id IS NULL

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
  const adminUserId = req.user.user_id;

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
  const adminUserId = req.user.user_id;

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
      s.role_title,
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

exports.getVerifiedStaff = catchAsync(async (req, res) => {
  const result = await sql.query`
    SELECT
      s.staff_id,
      s.user_id,
      u.email,
      s.full_name,
      s.role_title,
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
      s.role_title,
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