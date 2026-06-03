const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");
const generateSlots = require("../utilts/generate.Slots");
const { createNotification } = require("../utilts/notification");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

const normalizeId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const validateBookingTime = (booking_date, booking_from) => {
  if (!booking_date || !booking_from) {
    throw new AppError("booking_date and booking_from are required", 400);
  }

  if (!DATE_REGEX.test(booking_date)) {
    throw new AppError("booking_date must be in YYYY-MM-DD format", 400);
  }

  const [year, month, day] = booking_date.split("-").map(Number);
  const date = new Date(`${booking_date}T00:00:00`);
  if (
    isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new AppError("Invalid booking_date", 400);
  }

  if (!TIME_REGEX.test(booking_from)) {
    throw new AppError("booking_from must be in HH:mm format", 400);
  }

  const start = new Date(`${booking_date}T${booking_from}:00`);
  if (isNaN(start.getTime()) || start < new Date()) {
    throw new AppError("Invalid booking time", 400);
  }

  return new Date(start.getTime() + 30 * 60 * 1000)
    .toTimeString()
    .slice(0, 5);
};

const buildGuestEmail = () => {
  const token = crypto.randomBytes(6).toString("hex");
  return `guest+${Date.now()}-${token}@clynk.local`;
};

const createGuestPatient = async ({ patient_name, patient_phone }) => {
  const guestEmail = buildGuestEmail();
  const rawPassword = crypto.randomBytes(24).toString("hex");
  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const transaction = new sql.Transaction(sql.globalConnectionPool);
  let transactionStarted = false;

  try {
    await transaction.begin();
    transactionStarted = true;

    const userResult = await transaction.request().query`
      INSERT INTO dbo.Users (email, password, user_type)
      OUTPUT INSERTED.user_id
      VALUES (${guestEmail}, ${hashedPassword}, 'patient');
    `;

    const userId = userResult.recordset[0].user_id;

    const patientResult = await transaction.request().query`
      INSERT INTO dbo.Patients (user_id, full_name, phone)
      OUTPUT INSERTED.patient_id
      VALUES (${userId}, ${patient_name}, ${patient_phone || null});
    `;

    await transaction.commit();

    return {
      patient_id: patientResult.recordset[0].patient_id,
      patient_user_id: userId,
      full_name: patient_name,
      phone: patient_phone || null,
    };
  } catch (err) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error(
          "Failed to roll back guest patient creation transaction:",
          rollbackErr.message,
        );
      }
    }
    throw err;
  }
};

const getBookingTarget = async ({ doctor_id, staff_id }) => {
  if (doctor_id) {
    const target = (
      await sql.query`
        SELECT
          d.doctor_id,
          d.user_id,
          d.full_name,
          d.work_days,
          CONVERT(VARCHAR(5), d.work_from,108) AS work_from,
          CONVERT(VARCHAR(5), d.work_to,108)   AS work_to
        FROM dbo.Doctors d
        JOIN dbo.Users u
          ON u.user_id = d.user_id
        WHERE d.doctor_id = ${doctor_id}
          AND d.is_verified = 1
          AND u.is_active = 1;
      `
    ).recordset[0];

    if (!target) {
      throw new AppError("Doctor is not available", 404);
    }

    return target;
  }

  const target = (
    await sql.query`
      SELECT
        s.staff_id,
        s.user_id,
        s.full_name,
        s.work_days,
        CONVERT(VARCHAR(5), s.work_from,108) AS work_from,
        CONVERT(VARCHAR(5), s.work_to,108)   AS work_to
      FROM dbo.Staff s
      JOIN dbo.Users u
        ON u.user_id = s.user_id
      JOIN dbo.Clinics c
        ON c.clinic_id = s.clinic_id
      WHERE s.staff_id = ${staff_id}
        AND s.work_days IS NOT NULL
        AND s.work_from IS NOT NULL
        AND s.work_to IS NOT NULL
        AND s.is_verified = 1
        AND u.is_active = 1
        AND c.status = 'approved';
    `
  ).recordset[0];

  if (!target) {
    throw new AppError("Doctor is not available", 404);
  }

  return target;
};

const assertSlotAvailable = async ({
  target,
  doctor_id,
  staff_id,
  booking_date,
  booking_from,
  booking_to,
}) => {
  const day = new Date(booking_date)
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();

  const allowedDays = target.work_days
    .split(",")
    .map((d) => d.trim().toLowerCase());

  if (!allowedDays.includes(day)) {
    throw new AppError("Doctor does not work on this day", 400);
  }

  if (booking_from < target.work_from || booking_to > target.work_to) {
    throw new AppError("Invalid booking time", 400);
  }

  const overlap = doctor_id
    ? await sql.query`
        SELECT booking_id
        FROM dbo.Bookings
        WHERE doctor_id = ${doctor_id}
          AND booking_date = ${booking_date}
          AND status = 'confirmed'
          AND (${booking_from} < booking_to AND ${booking_to} > booking_from);
      `
    : await sql.query`
        SELECT booking_id
        FROM dbo.Bookings
        WHERE staff_id = ${staff_id}
          AND booking_date = ${booking_date}
          AND status = 'confirmed'
          AND (${booking_from} < booking_to AND ${booking_to} > booking_from);
      `;

  if (overlap.recordset.length) {
    throw new AppError("This time slot is already booked", 409);
  }
};

const assertPatientAvailability = async ({
  patient_user_id,
  booking_date,
  booking_from,
  booking_to,
}) => {
  const timeConflict = await sql.query`
    SELECT booking_id
    FROM dbo.Bookings
    WHERE patient_user_id = ${patient_user_id}
      AND booking_date = ${booking_date}
      AND status = 'confirmed'
      AND (${booking_from} < booking_to AND ${booking_to} > booking_from);
  `;

  if (timeConflict.recordset.length) {
    throw new AppError("Patient already has a booking at this time", 409);
  }

  const dayConflict = await sql.query`
    SELECT booking_id
    FROM dbo.Bookings
    WHERE patient_user_id = ${patient_user_id}
      AND booking_date = ${booking_date}
      AND status = 'confirmed';
  `;

  if (dayConflict.recordset.length) {
    throw new AppError("Patient already has a booking for this day", 409);
  }
};

const insertBooking = async ({
  patient_user_id,
  doctor_id,
  staff_id,
  booking_date,
  booking_from,
  booking_to,
}) => {
  const prescriptionAccessStatus = "accepted";
  const result = await sql.query`
    INSERT INTO dbo.Bookings
      (patient_user_id, doctor_id, staff_id,
       booking_date, booking_from, booking_to,
       prescription_access_status,
       prescription_access_responded_at)
    OUTPUT INSERTED.booking_id
    VALUES (
      ${patient_user_id},
      ${doctor_id || null},
      ${staff_id || null},
      ${booking_date},
      ${booking_from},
      ${booking_to},
      ${prescriptionAccessStatus},
      ${new Date()}
    );
  `;

  return {
    booking_id: result.recordset[0].booking_id,
    prescription_access_status: prescriptionAccessStatus,
  };
};

const createBookingRecord = async ({
  patient_user_id,
  doctor_id,
  staff_id,
  booking_date,
  booking_from,
}) => {
  if ((!doctor_id && !staff_id) || (doctor_id && staff_id)) {
    throw new AppError("Booking must target either a doctor or a staff member", 400);
  }

  const booking_to = validateBookingTime(booking_date, booking_from);

  await assertPatientAvailability({
    patient_user_id,
    booking_date,
    booking_from,
    booking_to,
  });

  const target = await getBookingTarget({ doctor_id, staff_id });

  await assertSlotAvailable({
    target,
    doctor_id,
    staff_id,
    booking_date,
    booking_from,
    booking_to,
  });

  const booking = await insertBooking({
    patient_user_id,
    doctor_id,
    staff_id,
    booking_date,
    booking_from,
    booking_to,
  });

  return { ...booking, booking_to, target };
};

const findPatientByName = async ({
  patient_name,
  patient_phone,
  createIfMissing = false,
}) => {
  const patientName = typeof patient_name === "string" ? patient_name.trim() : "";
  const patientPhone =
    typeof patient_phone === "string" ? patient_phone.trim() : "";

  if (!patientName) {
    throw new AppError("patient_name is required", 400);
  }

  const request = new sql.Request();
  request.input("patientName", sql.NVarChar(150), patientName);

  let phoneFilter = "";
  if (patientPhone) {
    phoneFilter = "AND p.phone = @patientPhone";
    request.input("patientPhone", sql.VarChar(20), patientPhone);
  }

  const result = await request.query(`
    SELECT TOP (2)
      p.patient_id,
      p.user_id AS patient_user_id,
      p.full_name,
      p.phone
    FROM dbo.Patients p
    JOIN dbo.Users u
      ON u.user_id = p.user_id
    WHERE LTRIM(RTRIM(p.full_name)) = @patientName
      ${phoneFilter}
      AND u.is_active = 1
    ORDER BY p.patient_id ASC;
  `);

  if (!result.recordset.length) {
    if (!createIfMissing) {
      throw new AppError("Patient not found", 404);
    }

    return createGuestPatient({
      patient_name: patientName,
      patient_phone: patientPhone || null,
    });
  }

  if (result.recordset.length > 1) {
    throw new AppError(
      "More than one patient matches this name. Add patient_phone to choose the patient.",
      409,
    );
  }

  return result.recordset[0];
};

const getProviderTargetForUser = async ({ user, staff_id }) => {
  if (user.user_type === "doctor") {
    const doctor = (
      await sql.query`
        SELECT doctor_id
        FROM dbo.Doctors
        WHERE user_id = ${user.user_id}
          AND is_verified = 1;
      `
    ).recordset[0];

    if (!doctor) {
      throw new AppError("Doctor profile not found or not verified", 404);
    }

    return { doctor_id: doctor.doctor_id, staff_id: null };
  }

  const staff = (
    await sql.query`
      SELECT staff_id, clinic_id, work_days, work_from, work_to, is_verified
      FROM dbo.Staff
      WHERE user_id = ${user.user_id}
        AND is_verified = 1;
    `
  ).recordset[0];

  if (!staff) {
    throw new AppError("Staff profile not found or not verified", 404);
  }

  const staffHasSchedule = Boolean(
    staff.work_days && staff.work_from && staff.work_to,
  );

  if (!staff_id && staffHasSchedule) {
    return { doctor_id: null, staff_id: staff.staff_id };
  }

  if (!staff_id) {
    throw new AppError("staff_id is required for non-doctor staff bookings", 400);
  }

  const staffDoctor = (
    await sql.query`
      SELECT s.staff_id
      FROM dbo.Staff s
      JOIN dbo.Users u
        ON u.user_id = s.user_id
      JOIN dbo.Clinics c
        ON c.clinic_id = s.clinic_id
      WHERE s.staff_id = ${staff_id}
        AND s.clinic_id = ${staff.clinic_id}
        AND s.work_days IS NOT NULL
        AND s.work_from IS NOT NULL
        AND s.work_to IS NOT NULL
        AND s.is_verified = 1
        AND u.is_active = 1
        AND c.status = 'approved';
    `
  ).recordset[0];

  if (!staffDoctor) {
    throw new AppError("Staff member is not available in your clinic", 404);
  }

  return { doctor_id: null, staff_id: staffDoctor.staff_id };
};

exports.createBooking = catchAsync(async (req, res) => {
  const { booking_date, booking_from } = req.body;
  const doctor_id = normalizeId(req.body.doctor_id);
  const staff_id = normalizeId(req.body.staff_id);
  const patient_user_id = req.user.user_id;

  const booking = await createBookingRecord({
    patient_user_id,
    doctor_id,
    staff_id,
    booking_date,
    booking_from,
  });

  await createNotification({
    user_id: booking.target.user_id,
    title: "New booking received",
    message: `A booking was scheduled on ${booking_date} from ${booking_from} to ${booking.booking_to}.`,
  });

  res.status(201).json({
    status: "success",
    booking_id: booking.booking_id,
    prescription_access_status: booking.prescription_access_status,
  });
});

exports.createProviderBooking = catchAsync(async (req, res) => {
  const { patient_name, patient_phone, booking_date } = req.body;
  const booking_from =
    req.body.booking_from || req.body.slot_from || req.body.slot?.from;
  const requestedStaffId = normalizeId(req.body.staff_id);

  const patient = await findPatientByName({
    patient_name,
    patient_phone,
    createIfMissing: true,
  });
  const { doctor_id, staff_id } = await getProviderTargetForUser({
    user: req.user,
    staff_id: requestedStaffId,
  });

  const booking = await createBookingRecord({
    patient_user_id: patient.patient_user_id,
    doctor_id,
    staff_id,
    booking_date,
    booking_from,
  });

  await createNotification({
    user_id: patient.patient_user_id,
    title: "Booking created",
    message: `${booking.target.full_name} scheduled a booking for ${booking_date} from ${booking_from} to ${booking.booking_to}.`,
  });

  res.status(201).json({
    status: "success",
    booking: {
      booking_id: booking.booking_id,
      patient: {
        patient_id: patient.patient_id,
        patient_user_id: patient.patient_user_id,
        full_name: patient.full_name,
        phone: patient.phone,
      },
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

  let ownerCondition = "";
  let ownerValue = null;

  if (user_type === "patient") {
    ownerCondition = "b.patient_user_id = @ownerId";
    ownerValue = user_id;
  }

  if (user_type === "doctor") {
    ownerCondition = `
      b.doctor_id = (
        SELECT doctor_id
        FROM dbo.Doctors
        WHERE user_id = @ownerId
      )
    `;
    ownerValue = user_id;
  }

  if (user_type === "staff") {
    ownerCondition = `
      b.staff_id = (
        SELECT staff_id
        FROM dbo.Staff
        WHERE user_id = @ownerId
      )
    `;
    ownerValue = user_id;
  }

  if (!ownerCondition) {
    return next(new AppError("Access denied", 403));
  }

  let dateCondition = "";
  if (date) {
    dateCondition = "AND b.booking_date = @bookingDate";
  }

  const request = new sql.Request();
  request.input("ownerId", ownerValue);

  if (date) {
    request.input("bookingDate", date);
  }

  const bookings = await request.query(`
    SELECT
      b.booking_id,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from,108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to,108)   AS booking_to,
      b.status,
      b.prescription_access_status,
      b.prescription_access_requested_at,
      b.prescription_access_responded_at,

      p.full_name AS patient_name,
      p.phone     AS patient_phone,

      COALESCE(d.full_name, s.full_name) AS doctor_name

    FROM dbo.Bookings b

    JOIN dbo.Patients p
      ON p.user_id = b.patient_user_id

    LEFT JOIN dbo.Doctors d
      ON d.doctor_id = b.doctor_id

    LEFT JOIN dbo.Staff s
      ON s.staff_id = b.staff_id

    WHERE ${ownerCondition}
      ${dateCondition}

    ORDER BY b.booking_date, b.booking_from;
  `);

  res.status(200).json({
    status: "success",
    results: bookings.recordset.length,
    bookings: bookings.recordset,
  });
});

exports.getClinicBookings = catchAsync(async (req, res, next) => {
  const clinic_id = req.clinic.clinic_id;
  const { date } = req.query;

  let dateFilter = "";
  const request = new sql.Request();
  request.input("clinicId", clinic_id);

  if (date) {
    dateFilter = "AND b.booking_date = @bookingDate";
    request.input("bookingDate", date);
  }

  const bookings = await request.query(`
    SELECT
      b.booking_id,
      b.booking_date,
      CONVERT(VARCHAR(5), b.booking_from, 108) AS booking_from,
      CONVERT(VARCHAR(5), b.booking_to, 108)   AS booking_to,
      b.status,
      b.prescription_access_status,
      b.prescription_access_requested_at,
      b.prescription_access_responded_at,

      p.full_name AS patient_name,
      p.phone     AS patient_phone,

      s.full_name AS doctor_name,

      c.name AS clinic_name

    FROM dbo.Bookings b

    JOIN dbo.Patients p
      ON p.user_id = b.patient_user_id

    LEFT JOIN dbo.Staff s
      ON s.staff_id = b.staff_id

    LEFT JOIN dbo.Clinics c
      ON c.clinic_id = s.clinic_id

    WHERE s.clinic_id = @clinicId
      ${dateFilter}

    ORDER BY b.booking_date, b.booking_from;
  `);

  res.status(200).json({
    status: "success",
    results: bookings.recordset.length,
    bookings: bookings.recordset,
  });
});

exports.getAvailableSlots = catchAsync(async (req, res, next) => {
  const { doctor_id, staff_id, booking_date } = req.query;

  if ((!doctor_id && !staff_id) || (doctor_id && staff_id)) {
    return next(new AppError("doctor_id or staff_id is required", 400));
  }

  if (!booking_date) {
    return next(new AppError("booking_date is required", 400));
  }

  let target;

  if (doctor_id) {
    target = (
      await sql.query`
        SELECT work_days,
               CONVERT(VARCHAR(5), work_from,108) AS work_from,
               CONVERT(VARCHAR(5), work_to,108)   AS work_to
        FROM dbo.Doctors d
        WHERE doctor_id = ${doctor_id}
          AND is_verified = 1;
      `
    ).recordset[0];
  } else {
    target = (
      await sql.query`
        SELECT work_days,
               CONVERT(VARCHAR(5), work_from,108) AS work_from,
               CONVERT(VARCHAR(5), work_to,108)   AS work_to
        FROM dbo.Staff
        WHERE staff_id = ${staff_id}
            AND work_days IS NOT NULL
            AND work_from IS NOT NULL
            AND work_to IS NOT NULL
          AND is_verified = 1;
      `
    ).recordset[0];
  }

  if (!target) return next(new AppError("Doctor is not available", 404));

  const day = new Date(booking_date)
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();

  const allowedDays = target.work_days
    .split(",")
    .map((d) => d.trim().toLowerCase());

  if (!allowedDays.includes(day)) {
    return res.json({ status: "success", slots: [] });
  }

  const allSlots = generateSlots(target.work_from, target.work_to, 30);

  const bookings = doctor_id
    ? await sql.query`
        SELECT CONVERT(VARCHAR(5), booking_from,108) AS booking_from,
               CONVERT(VARCHAR(5), booking_to,108)   AS booking_to
        FROM dbo.Bookings
        WHERE doctor_id=${doctor_id}
          AND booking_date=${booking_date}
          AND status='confirmed';
      `
    : await sql.query`
        SELECT CONVERT(VARCHAR(5), booking_from,108) AS booking_from,
               CONVERT(VARCHAR(5), booking_to,108)   AS booking_to
        FROM dbo.Bookings
        WHERE staff_id=${staff_id}
          AND booking_date=${booking_date}
          AND status='confirmed';
      `;

  const availableSlots = allSlots.filter(
    (slot) =>
      !bookings.recordset.some(
        (b) => slot.from < b.booking_to && slot.to > b.booking_from,
      ),
  );

  res.json({ status: "success", slots: availableSlots });
});

exports.cancelBooking = catchAsync(async (req, res, next) => {
  const booking_id = Number(req.params.id);
  const { user_id, user_type } = req.user;

  if (!booking_id) {
    return next(new AppError("Invalid booking id", 400));
  }

  const booking = (
    await sql.query`
      SELECT
        booking_id,
        patient_user_id,
        doctor_id,
        staff_id,
        status
      FROM dbo.Bookings
      WHERE booking_id = ${booking_id};
    `
  ).recordset[0];

  if (!booking) {
    return next(new AppError("Booking not found", 404));
  }

  if (booking.status === "cancelled") {
    return next(new AppError("Booking is already cancelled", 400));
  }

  let authorized = false;

  if (user_type === "patient") {
    authorized = booking.patient_user_id === user_id;
  }

  if (user_type === "doctor" && booking.doctor_id) {
    const doctor = (
      await sql.query`
        SELECT doctor_id
        FROM dbo.Doctors
        WHERE user_id = ${user_id};
      `
    ).recordset[0];

    authorized = doctor && doctor.doctor_id === booking.doctor_id;
  }

  if (user_type === "staff" && booking.staff_id) {
    const staff = (
      await sql.query`
        SELECT staff_id
        FROM dbo.Staff
        WHERE user_id = ${user_id};
      `
    ).recordset[0];

    authorized = staff && staff.staff_id === booking.staff_id;
  }

  if (!authorized) {
    return next(new AppError("Access denied", 403));
  }

  await sql.query`
    UPDATE dbo.Bookings
    SET status = 'cancelled'
    WHERE booking_id = ${booking_id};
  `;

  await createNotification({
    user_id: booking.patient_user_id,
    title: "تم إلغاء الحجز",
    message: "تم إلغاء حجزك.",
  });

  res.status(200).json({
    status: "success",
    message: "تم إلغاء الحجز بنجاح",
  });
});

exports.cancelClinicBooking = catchAsync(async (req, res, next) => {
  const booking_id = Number(req.params.id);
  const clinic_id = req.clinic.clinic_id;

  if (!booking_id) {
    return next(new AppError("Invalid booking id", 400));
  }

  const booking = (
    await sql.query`
      SELECT
        b.booking_id,
        b.status,
        b.patient_user_id,
        s.clinic_id
      FROM dbo.Bookings b
      JOIN dbo.Staff s
        ON s.staff_id = b.staff_id
      WHERE b.booking_id = ${booking_id};
    `
  ).recordset[0];

  if (!booking) {
    return next(new AppError("Booking not found", 404));
  }

  if (booking.clinic_id !== clinic_id) {
    return next(new AppError("Access denied", 403));
  }

  if (booking.status === "cancelled") {
    return next(new AppError("Booking is already cancelled", 400));
  }

  await sql.query`
    UPDATE dbo.Bookings
    SET status = 'cancelled'
    WHERE booking_id = ${booking_id};
  `;

  await createNotification({
    user_id: booking.patient_user_id,
    title: "تم إلغاء الحجز",
    message: "تم إلغاء حجزك من قبل العيادة.",
  });

  res.status(200).json({
    status: "success",
    message: "تم إلغاء الحجز بنجاح",
  });
});
