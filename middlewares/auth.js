const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");

exports.protect = catchAsync(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError(
        "You are not logged in. Please log in to access this route.",
        401,
      ),
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(
      new AppError("Token is invalid or expired. Please log in again.", 401),
    );
  }

  const user = await User.findById(decoded.user_id).select(
    "email user_type is_active created_at photo",
  );

  if (!user || !user.is_active) {
    return next(
      new AppError(
        "The user associated with this token does not exist or is inactive.",
        401,
      ),
    );
  }

  req.user = {
    user_id: user._id,
    email: user.email,
    user_type: user.user_type,
    is_active: user.is_active,
    photo: user.photo,
  };
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.user_type)) {
      return next(
        new AppError("You do not have permission to perform this action.", 403),
      );
    }
    next();
  };
};
