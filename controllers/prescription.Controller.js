const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const { createNotification } = require("../utilts/notification");

const parseId = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`Invalid ${fieldName}`, 400);
  }
  return parsed;
};

const normalizeText = (value, fieldName, maxLength) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new AppError(`${fieldName} must be a string`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new AppError(
      `${fieldName} must not exceed ${maxLength} characters`,
      400,
    );
  }

  return trimmed;
};

const parseOptionalInteger = (value, fieldName, min = 0, max = 150) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(
      `${fieldName} must be an integer between ${min} and ${max}`,
      400,
    );
  }

  return parsed;
};

const parseOptionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }

  return parsed;
};

const resolveAccessAction = (value) => {
  if (typeof value !== "string") {
    throw new AppError("action is required", 400);
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "accept" || normalized === "accepted") {
    return "accepted";
  }

  if (normalized === "reject" || normalized === "rejected") {
    return "rejected";
  }

  throw new AppError("action must be accept or reject", 400);
};

const formatDate = (value) => {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toISOString().slice(0, 10);
};

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) {
    return null;
  }

  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

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

  const hasMedicalContent = [
    payload.symptoms,
    payload.diagnosis,
    payload.medication_name,
    payload.test_name,
    payload.notes,
  ].some(Boolean);

  if (!hasMedicalContent) {
    throw new AppError(
      "At least one of symptoms, diagnosis, medication_name, test_name, or notes is required",
      400,
    );
  }

  if ((payload.dose || payload.duration) && !payload.medication_name) {
    throw new AppError(
      "medication_name is required when dose or duration is provided",
      400,
    );
  }

  if ((payload.test_result || payload.test_date) && !payload.test_name) {
    throw new AppError(
      "test_name is required when test_result or test_date is provided",
      400,
    );
  }

  return payload;
};

const getProviderProfile = async (user) => {
  if (user.user_type === "doctor") {
    const doctor = (
      await sql.query`
        SELECT
          doctor_id,
          user_id,
          full_name,
          specialist,
          phone
        FROM dbo.Doctors
        WHERE user_id = ${user.user_id}
          AND is_verified = 1;
      `
    ).recordset[0];

    if (!doctor) {
      throw new AppError("Doctor profile not found", 404);
    }

    return {
      provider_type: "doctor",
      doctor_id: doctor.doctor_id,
      staff_id: null,
      user_id: doctor.user_id,
      full_name: doctor.full_name,
      specialist: doctor.specialist,
      contact_phone: doctor.phone,
    };
  }

  if (user.user_type === "staff") {
    const staff = (
      await sql.query`
        SELECT
          staff_id,
          user_id,
          full_name,
          specialist
        FROM dbo.Staff
        WHERE user_id = ${user.user_id}
          AND work_days IS NOT NULL
          AND work_from IS NOT NULL
          AND work_to IS NOT NULL
          AND is_verified = 1;
      `
    ).recordset[0];

    if (!staff) {
      throw new AppError("Doctor staff profile not found", 404);
    }

    return {
      provider_type: "staff",
      doctor_id: null,
      staff_id: staff.staff_id,
      user_id: staff.user_id,
      full_name: staff.full_name,
      specialist: staff.specialist,
      contact_phone: null,
    };
  }

  throw new AppError("Only doctors can manage prescriptions", 403);
};

const getBookingDetails = async (bookingId) => {
  return (
    await sql.query`
      SELECT
        b.booking_id,
        b.patient_user_id,
        b.doctor_id,
        b.staff_id,
        b.booking_date,
        CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
        CONVERT(VARCHAR(5), b.booking_to, 108) AS booking_to,
        b.status,
        b.prescription_access_status,
        b.prescription_access_requested_at,
        b.prescription_access_responded_at,

        p.patient_id,
        p.full_name AS patient_name,
        p.date_of_birth,

        d.user_id AS direct_doctor_user_id,
        d.full_name AS direct_doctor_name,
        d.specialist AS direct_doctor_specialist,
        d.phone AS direct_doctor_phone,

        s.user_id AS staff_doctor_user_id,
        s.full_name AS staff_doctor_name,
        s.specialist AS staff_doctor_specialist,
        c.phone AS clinic_phone

      FROM dbo.Bookings b
      JOIN dbo.Patients p
        ON p.user_id = b.patient_user_id
      LEFT JOIN dbo.Doctors d
        ON d.doctor_id = b.doctor_id
      LEFT JOIN dbo.Staff s
        ON s.staff_id = b.staff_id
      LEFT JOIN dbo.Clinics c
        ON c.clinic_id = s.clinic_id
      WHERE b.booking_id = ${bookingId};
    `
  ).recordset[0];
};

const bookingBelongsToProvider = (booking, provider) => {
  if (provider.provider_type === "doctor") {
    return booking.doctor_id === provider.doctor_id;
  }

  return booking.staff_id === provider.staff_id;
};

const getPrescriptionByBooking = async (bookingId) => {
  return (
    await sql.query`
      SELECT TOP 1 prescription_id
      FROM dbo.Prescriptions
      WHERE booking_id = ${bookingId};
    `
  ).recordset[0];
};

const getSavedPrescriptionPermission = async (patientUserId, booking) => {
  if (booking.doctor_id) {
    return (
      await sql.query`
        SELECT TOP 1 permission_id
        FROM dbo.PrescriptionPermissions
        WHERE patient_user_id = ${patientUserId}
          AND doctor_id = ${booking.doctor_id}
          AND status = 'accepted';
      `
    ).recordset[0];
  }

  return (
    await sql.query`
      SELECT TOP 1 permission_id
      FROM dbo.PrescriptionPermissions
      WHERE patient_user_id = ${patientUserId}
        AND staff_id = ${booking.staff_id}
        AND status = 'accepted';
    `
  ).recordset[0];
};

const upsertPrescriptionPermission = async (
  patientUserId,
  booking,
  permissionStatus,
) => {
  if (booking.doctor_id) {
    const existing = (
      await sql.query`
        SELECT TOP 1 permission_id
        FROM dbo.PrescriptionPermissions
        WHERE patient_user_id = ${patientUserId}
          AND doctor_id = ${booking.doctor_id};
      `
    ).recordset[0];

    if (existing) {
      await sql.query`
        UPDATE dbo.PrescriptionPermissions
        SET
          status = ${permissionStatus},
          accepted_at = CASE
            WHEN ${permissionStatus} = 'accepted' THEN SYSDATETIME()
            ELSE accepted_at
          END,
          updated_at = SYSDATETIME()
        WHERE permission_id = ${existing.permission_id};
      `;

      return;
    }

    await sql.query`
      INSERT INTO dbo.PrescriptionPermissions (
        patient_user_id,
        doctor_id,
        staff_id,
        status
      )
      VALUES (
        ${patientUserId},
        ${booking.doctor_id},
        NULL,
        ${permissionStatus}
      );
    `;

    return;
  }

  const existing = (
    await sql.query`
      SELECT TOP 1 permission_id
      FROM dbo.PrescriptionPermissions
      WHERE patient_user_id = ${patientUserId}
        AND staff_id = ${booking.staff_id};
    `
  ).recordset[0];

  if (existing) {
    await sql.query`
      UPDATE dbo.PrescriptionPermissions
      SET
        status = ${permissionStatus},
        accepted_at = CASE
          WHEN ${permissionStatus} = 'accepted' THEN SYSDATETIME()
          ELSE accepted_at
        END,
        updated_at = SYSDATETIME()
      WHERE permission_id = ${existing.permission_id};
    `;

    return;
  }

  await sql.query`
    INSERT INTO dbo.PrescriptionPermissions (
      patient_user_id,
      doctor_id,
      staff_id,
      status
    )
    VALUES (
      ${patientUserId},
      NULL,
      ${booking.staff_id},
      ${permissionStatus}
    );
  `;
};

const buildPrescriptionViewerScope = async (user) => {
  if (user.user_type === "patient") {
    return {
      condition: "pt.user_id = @viewerUserId",
      params: [{ name: "viewerUserId", value: user.user_id }],
    };
  }

  const provider = await getProviderProfile(user);

  if (provider.provider_type === "doctor") {
    return {
      condition: "pr.doctor_id = @providerId",
      params: [{ name: "providerId", value: provider.doctor_id }],
    };
  }

  return {
    condition: "pr.staff_id = @providerId",
    params: [{ name: "providerId", value: provider.staff_id }],
  };
};

exports.requestPrescriptionAccess = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const provider = await getProviderProfile(req.user);
  const booking = await getBookingDetails(bookingId);

  if (!booking) {
    return next(new AppError("Booking not found", 404));
  }

  if (!bookingBelongsToProvider(booking, provider)) {
    return next(new AppError("You can only request access for your own booking", 403));
  }

  if (booking.status !== "confirmed") {
    return next(new AppError("Prescription access can only be requested for confirmed bookings", 400));
  }

  const existingPrescription = await getPrescriptionByBooking(bookingId);
  if (existingPrescription) {
    return next(new AppError("A prescription already exists for this booking", 400));
  }

  const savedPermission = await getSavedPrescriptionPermission(
    booking.patient_user_id,
    booking,
  );

  if (savedPermission || booking.prescription_access_status === "accepted") {
    await sql.query`
      UPDATE dbo.Bookings
      SET
        prescription_access_status = 'accepted',
        prescription_access_requested_at = NULL,
        prescription_access_responded_at = COALESCE(
          prescription_access_responded_at,
          SYSDATETIME()
        )
      WHERE booking_id = ${bookingId};
    `;

    return res.status(200).json({
      status: "success",
      message: "Prescription access is already approved for this doctor",
      booking: {
        booking_id: bookingId,
        prescription_access_status: "accepted",
      },
    });
  }

  if (booking.prescription_access_status === "pending") {
    return next(new AppError("Prescription access is already pending patient approval", 400));
  }

  await sql.query`
    UPDATE dbo.Bookings
    SET
      prescription_access_status = 'pending',
      prescription_access_requested_at = SYSDATETIME(),
      prescription_access_responded_at = NULL
    WHERE booking_id = ${bookingId};
  `;

  await createNotification({
    user_id: booking.patient_user_id,
    title: "طلب صلاحية كتابة روشتة",
    message: `طلب ${provider.full_name} إذنك لكتابة روشتة لحجزك بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(200).json({
    status: "success",
    message: "Prescription access request sent successfully",
    booking: {
      booking_id: bookingId,
      prescription_access_status: "pending",
    },
  });
});

exports.respondToPrescriptionAccess = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const nextStatus = resolveAccessAction(req.body.action);
  const booking = await getBookingDetails(bookingId);

  if (!booking) {
    return next(new AppError("Booking not found", 404));
  }

  if (booking.patient_user_id !== req.user.user_id) {
    return next(new AppError("You can only respond to your own booking requests", 403));
  }

  if (booking.status !== "confirmed") {
    return next(new AppError("Only confirmed bookings can receive prescription access approval", 400));
  }

  if (booking.prescription_access_status !== "pending") {
    return next(new AppError("There is no pending prescription access request for this booking", 400));
  }

  const providerUserId =
    booking.direct_doctor_user_id || booking.staff_doctor_user_id;

  if (!providerUserId) {
    return next(new AppError("Booking provider not found", 404));
  }

  await upsertPrescriptionPermission(
    booking.patient_user_id,
    booking,
    nextStatus === "accepted" ? "accepted" : "revoked",
  );

  await sql.query`
    UPDATE dbo.Bookings
    SET
      prescription_access_status = ${nextStatus},
      prescription_access_responded_at = SYSDATETIME()
    WHERE booking_id = ${bookingId};
  `;

  await createNotification({
    user_id: providerUserId,
    title: "رد على طلب صلاحية الروشتة",
    message: `قام ${booking.patient_name} بـ${nextStatus === "accepted" ? "قبول" : "رفض"} طلب كتابة الروشتة لحجز بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(200).json({
    status: "success",
    message: `Prescription access ${nextStatus} successfully`,
    booking: {
      booking_id: bookingId,
      prescription_access_status: nextStatus,
    },
  });
});

exports.createPrescription = catchAsync(async (req, res, next) => {
  const bookingId = parseId(req.params.bookingId, "booking id");
  const provider = await getProviderProfile(req.user);
  const booking = await getBookingDetails(bookingId);

  if (!booking) {
    return next(new AppError("Booking not found", 404));
  }

  if (!bookingBelongsToProvider(booking, provider)) {
    return next(new AppError("You can only create prescriptions for your own booking", 403));
  }

  if (booking.status !== "confirmed") {
    return next(new AppError("Only confirmed bookings can receive a prescription", 400));
  }

  if (booking.prescription_access_status !== "accepted") {
    return next(new AppError("Patient approval is required before creating a prescription", 403));
  }

  const existingPrescription = await getPrescriptionByBooking(bookingId);
  if (existingPrescription) {
    return next(new AppError("A prescription already exists for this booking", 409));
  }

  const payload = parsePrescriptionBody(req.body);
  const patientAge = payload.patient_age ?? calculateAge(booking.date_of_birth);
  const providerName =
    booking.direct_doctor_name || booking.staff_doctor_name || provider.full_name;
  const providerSpecialty =
    booking.direct_doctor_specialist ||
    booking.staff_doctor_specialist ||
    provider.specialist;
  const providerContact =
    booking.direct_doctor_phone || booking.clinic_phone || provider.contact_phone;
  const visitDate = payload.visit_date || new Date();

  const result = await sql.query`
    INSERT INTO dbo.Prescriptions (
      booking_id,
      patient_id,
      doctor_id,
      staff_id,
      patient_age,
      doctor_name,
      specialty,
      doctor_emergency_contact,
      visit_date,
      symptoms,
      diagnosis,
      medication_name,
      dose,
      duration,
      test_name,
      test_result,
      test_date,
      notes
    )
    OUTPUT INSERTED.prescription_id
    VALUES (
      ${bookingId},
      ${booking.patient_id},
      ${provider.doctor_id},
      ${provider.staff_id},
      ${patientAge},
      ${providerName},
      ${providerSpecialty},
      ${providerContact},
      ${visitDate},
      ${payload.symptoms},
      ${payload.diagnosis},
      ${payload.medication_name},
      ${payload.dose},
      ${payload.duration},
      ${payload.test_name},
      ${payload.test_result},
      ${payload.test_date},
      ${payload.notes}
    );
  `;

  await createNotification({
    user_id: booking.patient_user_id,
    title: "روشتة جديدة",
    message: `أرسل ${providerName} روشتة لحجزك بتاريخ ${formatDate(booking.booking_date)}.`,
  });

  res.status(201).json({
    status: "success",
    message: "Prescription created successfully",
    prescription: {
      prescription_id: result.recordset[0].prescription_id,
      booking_id: bookingId,
      prescription_access_status: booking.prescription_access_status,
    },
  });
});

exports.getMyPrescriptions = catchAsync(async (req, res) => {
  const scope = await buildPrescriptionViewerScope(req.user);
  const request = new sql.Request();

  scope.params.forEach((param) => {
    request.input(param.name, param.value);
  });

  const result = await request.query(`
    SELECT
      pr.prescription_id,
      pr.booking_id,
      pr.patient_age,
      pr.visit_date,
      pr.symptoms,
      pr.diagnosis,
      pr.medication_name,
      pr.dose,
      pr.duration,
      pr.test_name,
      pr.test_result,
      pr.test_date,
      pr.notes,
      pr.created_at,
      pt.full_name AS patient_name,
      COALESCE(d.full_name, s.full_name, pr.doctor_name) AS provider_name,
      COALESCE(d.specialist, s.specialist, pr.specialty) AS provider_specialty,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to, 108) AS booking_to,
      CASE
        WHEN pr.doctor_id IS NOT NULL THEN 'doctor'
        ELSE 'staff'
      END AS prescriber_type
    FROM dbo.Prescriptions pr
    JOIN dbo.Patients pt
      ON pt.patient_id = pr.patient_id
    LEFT JOIN dbo.Bookings b
      ON b.booking_id = pr.booking_id
    LEFT JOIN dbo.Doctors d
      ON d.doctor_id = pr.doctor_id
    LEFT JOIN dbo.Staff s
      ON s.staff_id = pr.staff_id
    WHERE ${scope.condition}
    ORDER BY pr.created_at DESC;
  `);

  res.status(200).json({
    status: "success",
    results: result.recordset.length,
    prescriptions: result.recordset,
  });
});

exports.getPrescriptionById = catchAsync(async (req, res, next) => {
  const prescriptionId = parseId(req.params.id, "prescription id");
  const scope = await buildPrescriptionViewerScope(req.user);
  const request = new sql.Request();

  request.input("prescriptionId", prescriptionId);
  scope.params.forEach((param) => {
    request.input(param.name, param.value);
  });

  const result = await request.query(`
    SELECT
      pr.prescription_id,
      pr.booking_id,
      pr.patient_age,
      pr.visit_date,
      pr.symptoms,
      pr.diagnosis,
      pr.medication_name,
      pr.dose,
      pr.duration,
      pr.test_name,
      pr.test_result,
      pr.test_date,
      pr.notes,
      pr.doctor_name,
      pr.specialty,
      pr.doctor_emergency_contact,
      pr.created_at,
      pt.full_name AS patient_name,
      COALESCE(d.full_name, s.full_name, pr.doctor_name) AS provider_name,
      COALESCE(d.specialist, s.specialist, pr.specialty) AS provider_specialty,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to, 108) AS booking_to,
      CASE
        WHEN pr.doctor_id IS NOT NULL THEN 'doctor'
        ELSE 'staff'
      END AS prescriber_type
    FROM dbo.Prescriptions pr
    JOIN dbo.Patients pt
      ON pt.patient_id = pr.patient_id
    LEFT JOIN dbo.Bookings b
      ON b.booking_id = pr.booking_id
    LEFT JOIN dbo.Doctors d
      ON d.doctor_id = pr.doctor_id
    LEFT JOIN dbo.Staff s
      ON s.staff_id = pr.staff_id
    WHERE pr.prescription_id = @prescriptionId
      AND ${scope.condition};
  `);

  if (!result.recordset.length) {
    return next(new AppError("Prescription not found", 404));
  }

  res.status(200).json({
    status: "success",
    prescription: result.recordset[0],
  });
});
