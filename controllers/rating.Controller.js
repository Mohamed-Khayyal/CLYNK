const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parsePagination = (query) => {
  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};

const parseRatingBody = (body) => {
  const rating = Number(body.rating);
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("rating must be an integer between 1 and 5", 400);
  }

  if (!comment) {
    throw new AppError("comment is required", 400);
  }

  if (comment.length > 500) {
    throw new AppError("comment must not exceed 500 characters", 400);
  }

  return { rating, comment };
};

const getDoctor = async (doctorId) => {
  return (
    await sql.query`
      SELECT doctor_id, user_id
      FROM dbo.Doctors
      WHERE doctor_id = ${doctorId}
        AND is_verified = 1;
    `
  ).recordset[0];
};

const getClinic = async (clinicId) => {
  return (
    await sql.query`
      SELECT clinic_id
      FROM dbo.Clinics
      WHERE clinic_id = ${clinicId}
        AND status = 'approved';
    `
  ).recordset[0];
};

const getStaff = async (staffId) => {
  return (
    await sql.query`
      SELECT staff_id, user_id
      FROM dbo.Staff
      WHERE staff_id = ${staffId}
        AND is_verified = 1;
    `
  ).recordset[0];
};

const hasConfirmedDoctorBooking = async (patientUserId, doctorId) => {
  const result = await sql.query`
    SELECT TOP 1 booking_id
    FROM dbo.Bookings
    WHERE patient_user_id = ${patientUserId}
      AND doctor_id = ${doctorId}
      AND status = 'confirmed';
  `;

  return result.recordset.length > 0;
};

const hasConfirmedClinicBooking = async (patientUserId, clinicId) => {
  const result = await sql.query`
    SELECT TOP 1 b.booking_id
    FROM dbo.Bookings b
    LEFT JOIN dbo.Staff s
      ON s.staff_id = b.staff_id
    WHERE b.patient_user_id = ${patientUserId}
      AND b.status = 'confirmed'
      AND s.clinic_id = ${clinicId};
  `;

  return result.recordset.length > 0;
};

const hasConfirmedStaffBooking = async (patientUserId, staffId) => {
  const result = await sql.query`
    SELECT TOP 1 booking_id
    FROM dbo.Bookings
    WHERE patient_user_id = ${patientUserId}
      AND staff_id = ${staffId}
      AND status = 'confirmed';
  `;

  return result.recordset.length > 0;
};

const upsertDoctorRating = async (patientUserId, doctorId, rating, comment) => {
  const existing = await sql.query`
    SELECT rating_id
    FROM dbo.Ratings
    WHERE patient_user_id = ${patientUserId}
      AND doctor_id = ${doctorId};
  `;

  if (existing.recordset.length) {
    const updated = await sql.query`
      UPDATE dbo.Ratings
      SET
        rating = ${rating},
        comment = ${comment},
        updated_at = SYSDATETIME()
      OUTPUT INSERTED.rating_id
      WHERE patient_user_id = ${patientUserId}
        AND doctor_id = ${doctorId};
    `;

    return {
      action: "updated",
      rating_id: updated.recordset[0].rating_id,
    };
  }

  const created = await sql.query`
    INSERT INTO dbo.Ratings
      (patient_user_id, doctor_id, clinic_id, rating, comment)
    OUTPUT INSERTED.rating_id
    VALUES
      (${patientUserId}, ${doctorId}, NULL, ${rating}, ${comment});
  `;

  return {
    action: "created",
    rating_id: created.recordset[0].rating_id,
  };
};

const upsertClinicRating = async (patientUserId, clinicId, rating, comment) => {
  const existing = await sql.query`
    SELECT rating_id
    FROM dbo.Ratings
    WHERE patient_user_id = ${patientUserId}
      AND clinic_id = ${clinicId};
  `;

  if (existing.recordset.length) {
    const updated = await sql.query`
      UPDATE dbo.Ratings
      SET
        rating = ${rating},
        comment = ${comment},
        updated_at = SYSDATETIME()
      OUTPUT INSERTED.rating_id
      WHERE patient_user_id = ${patientUserId}
        AND clinic_id = ${clinicId};
    `;

    return {
      action: "updated",
      rating_id: updated.recordset[0].rating_id,
    };
  }

  const created = await sql.query`
    INSERT INTO dbo.Ratings
      (patient_user_id, doctor_id, clinic_id, rating, comment)
    OUTPUT INSERTED.rating_id
    VALUES
      (${patientUserId}, NULL, ${clinicId}, ${rating}, ${comment});
  `;

  return {
    action: "created",
    rating_id: created.recordset[0].rating_id,
  };
};

const upsertStaffRating = async (patientUserId, staffId, rating, comment) => {
  const existing = await sql.query`
    SELECT rating_id
    FROM dbo.Ratings
    WHERE patient_user_id = ${patientUserId}
      AND staff_id = ${staffId};
  `;

  if (existing.recordset.length) {
    const updated = await sql.query`
      UPDATE dbo.Ratings
      SET
        rating = ${rating},
        comment = ${comment},
        updated_at = SYSDATETIME()
      OUTPUT INSERTED.rating_id
      WHERE patient_user_id = ${patientUserId}
        AND staff_id = ${staffId};
    `;

    return {
      action: "updated",
      rating_id: updated.recordset[0].rating_id,
    };
  }

  const created = await sql.query`
    INSERT INTO dbo.Ratings
      (patient_user_id, doctor_id, clinic_id, staff_id, rating, comment)
    OUTPUT INSERTED.rating_id
    VALUES
      (${patientUserId}, NULL, NULL, ${staffId}, ${rating}, ${comment});
  `;

  return {
    action: "created",
    rating_id: created.recordset[0].rating_id,
  };
};

const getSummary = (summaryRow) => {
  const total_ratings = Number(summaryRow.total_ratings) || 0;
  const average_rating = Number(summaryRow.average_rating) || 0;

  return {
    total_ratings,
    average_rating,
  };
};

exports.rateDoctor = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.doctorId);
  if (!doctorId) {
    return next(new AppError("Invalid doctor id", 400));
  }

  const doctor = await getDoctor(doctorId);
  if (!doctor) {
    return next(new AppError("Doctor not found", 404));
  }

  const { rating, comment } = parseRatingBody(req.body);
  const patientUserId = req.user.user_id;

  const booked = await hasConfirmedDoctorBooking(patientUserId, doctorId);
  if (!booked) {
    return next(
      new AppError("You can rate only doctors you previously booked with", 403),
    );
  }

  const result = await upsertDoctorRating(
    patientUserId,
    doctorId,
    rating,
    comment,
  );

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message:
      result.action === "created"
        ? "تم إنشاء تقييم الطبيب"
        : "تم تحديث تقييم الطبيب",
    rating: {
      rating_id: result.rating_id,
      doctor_id: doctorId,
      rating,
      comment,
    },
  });
});

exports.rateClinic = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.clinicId);
  if (!clinicId) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const clinic = await getClinic(clinicId);
  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  const { rating, comment } = parseRatingBody(req.body);
  const patientUserId = req.user.user_id;

  const booked = await hasConfirmedClinicBooking(patientUserId, clinicId);
  if (!booked) {
    return next(
      new AppError("You can rate only clinics you previously booked with", 403),
    );
  }

  const result = await upsertClinicRating(
    patientUserId,
    clinicId,
    rating,
    comment,
  );

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message:
      result.action === "created"
        ? "تم إنشاء تقييم العيادة"
        : "تم تحديث تقييم العيادة",
    rating: {
      rating_id: result.rating_id,
      clinic_id: clinicId,
      rating,
      comment,
    },
  });
});

exports.rateStaff = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) {
    return next(new AppError("Invalid staff id", 400));
  }

  const staff = await getStaff(staffId);
  if (!staff) {
    return next(new AppError("Staff member not found", 404));
  }

  const { rating, comment } = parseRatingBody(req.body);
  const patientUserId = req.user.user_id;

  const booked = await hasConfirmedStaffBooking(patientUserId, staffId);
  if (!booked) {
    return next(
      new AppError("You can rate only staff you previously booked with", 403),
    );
  }

  const result = await upsertStaffRating(
    patientUserId,
    staffId,
    rating,
    comment,
  );

  res.status(result.action === "created" ? 201 : 200).json({
    status: "success",
    message:
      result.action === "created"
        ? "تم إنشاء تقييم الموظف"
        : "تم تحديث تقييم الموظف",
    rating: {
      rating_id: result.rating_id,
      staff_id: staffId,
      rating,
      comment,
    },
  });
});

exports.getDoctorRatings = catchAsync(async (req, res, next) => {
  const doctorId = parseId(req.params.doctorId);
  if (!doctorId) {
    return next(new AppError("Invalid doctor id", 400));
  }

  const doctor = await getDoctor(doctorId);
  if (!doctor) {
    return next(new AppError("Doctor not found", 404));
  }

  const { page, limit, offset } = parsePagination(req.query);

  const summaryRow = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,
        CAST(
          ISNULL(ROUND(AVG(CAST(r.rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)
        ) AS average_rating
      FROM dbo.Ratings r
      WHERE r.doctor_id = ${doctorId};
    `
  ).recordset[0];

  const ratings = await sql.query`
    SELECT
      r.rating_id,
      r.rating,
      r.comment,
      p.full_name AS patient_name,
      u.photo AS patient_photo
    FROM dbo.Ratings r
    JOIN dbo.Patients p
      ON p.user_id = r.patient_user_id
    JOIN dbo.Users u
      ON u.user_id = r.patient_user_id
    WHERE r.doctor_id = ${doctorId}
    ORDER BY COALESCE(r.updated_at, r.created_at) DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
  `;

  const summary = getSummary(summaryRow);

  res.status(200).json({
    status: "success",
    summary,
    pagination: {
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)),
    },
    results: ratings.recordset.length,
    ratings: ratings.recordset,
  });
});

exports.getClinicRatings = catchAsync(async (req, res, next) => {
  const clinicId = parseId(req.params.clinicId);
  if (!clinicId) {
    return next(new AppError("Invalid clinic id", 400));
  }

  const clinic = await getClinic(clinicId);
  if (!clinic) {
    return next(new AppError("Clinic not found", 404));
  }

  const { page, limit, offset } = parsePagination(req.query);

  const summaryRow = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,
        CAST(
          ISNULL(ROUND(AVG(CAST(r.rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)
        ) AS average_rating
      FROM dbo.Ratings r
      WHERE r.clinic_id = ${clinicId};
    `
  ).recordset[0];

  const ratings = await sql.query`
    SELECT
      r.rating_id,
      r.rating,
      r.comment,
      p.full_name AS patient_name,
      u.photo AS patient_photo
    FROM dbo.Ratings r
    JOIN dbo.Patients p
      ON p.user_id = r.patient_user_id
    JOIN dbo.Users u
      ON u.user_id = r.patient_user_id
    WHERE r.clinic_id = ${clinicId}
    ORDER BY COALESCE(r.updated_at, r.created_at) DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
  `;

  const summary = getSummary(summaryRow);

  res.status(200).json({
    status: "success",
    summary,
    pagination: {
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)),
    },
    results: ratings.recordset.length,
    ratings: ratings.recordset,
  });
});

exports.getStaffRatings = catchAsync(async (req, res, next) => {
  const staffId = parseId(req.params.staffId);
  if (!staffId) {
    return next(new AppError("Invalid staff id", 400));
  }

  const staff = await getStaff(staffId);
  if (!staff) {
    return next(new AppError("Staff member not found", 404));
  }

  const { page, limit, offset } = parsePagination(req.query);

  const summaryRow = (
    await sql.query`
      SELECT
        COUNT(*) AS total_ratings,
        CAST(
          ISNULL(ROUND(AVG(CAST(r.rating AS FLOAT)), 1), 0) AS DECIMAL(3, 1)
        ) AS average_rating
      FROM dbo.Ratings r
      WHERE r.staff_id = ${staffId};
    `
  ).recordset[0];

  const ratings = await sql.query`
    SELECT
      r.rating_id,
      r.rating,
      r.comment,
      p.full_name AS patient_name,
      u.photo AS patient_photo
    FROM dbo.Ratings r
    JOIN dbo.Patients p
      ON p.user_id = r.patient_user_id
    JOIN dbo.Users u
      ON u.user_id = r.patient_user_id
    WHERE r.staff_id = ${staffId}
    ORDER BY COALESCE(r.updated_at, r.created_at) DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
  `;

  const summary = getSummary(summaryRow);

  res.status(200).json({
    status: "success",
    summary,
    pagination: {
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(summary.total_ratings / limit)),
    },
    results: ratings.recordset.length,
    ratings: ratings.recordset,
  });
});
