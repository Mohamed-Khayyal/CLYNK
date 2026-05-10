const { sql } = require("../config/db.Config");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");

exports.isClinicOwner = catchAsync(async (req, res, next) => {
  const ownerUserId = req.user.user_id;

  if (req.user.user_type !== "clinic") {
    return next(new AppError("Only clinic accounts can access this resource", 403));
  }

  const clinicResult = await sql.query`
    SELECT
      clinic_id,
      owner_user_id,
      status
    FROM dbo.Clinics
    WHERE owner_user_id = ${ownerUserId};
  `;

  const clinic = clinicResult.recordset[0];

  if (!clinic) {
    return next(new AppError("You do not own any clinic", 403));
  }

  if (clinic.status !== "approved") {
    return next(new AppError("Clinic is not approved yet", 403));
  }

  req.clinic = clinic;

  next();
});
