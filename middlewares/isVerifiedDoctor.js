const Doctor = require("../models/Doctor.model");
const AppError = require("../utilts/app.Error");
const catchAsync = require("../utilts/catch.Async");

exports.isVerifiedDoctor = catchAsync(async (req, res, next) => {
  const userId = req.user.user_id;

  const doctor = await Doctor.findOne({ user_id: userId });

  if (!doctor) {
    return next(new AppError("Doctor profile not found", 404));
  }

  if (!doctor.is_verified) {
    return next(
      new AppError("Your account must be verified before creating a clinic", 403)
    );
  }

  next();
});
