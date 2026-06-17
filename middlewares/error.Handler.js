const STATUS_CODES = require("../utilts/response.Codes");
const responsesStatus = require("../utilts/response.Status");
const AppError = require("../utilts/app.Error");
const ERROR_CODES = require("../utilts/error.Codes");
const { logAuditEvent, sanitizeAuditBody } = require("../utilts/audit.Logger");

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || STATUS_CODES.INTERNAL_SERVER_ERROR;
  err.status = err.status || responsesStatus.ERROR;
  err.errorCode = err.errorCode || ERROR_CODES.SERVER_ERROR;

  if (err.name === "CastError") {
    const message = `Invalid value in ${err.path}: ${err.value}.`;
    err = new AppError(
      message,
      STATUS_CODES.BAD_REQUEST,
      ERROR_CODES.CAST_ERROR,
    );
  }

  if (err.code === 11000) {
    const value = Object.values(err.keyValue).join(", ");
    const message = `Duplicate field value: "${value}". Please use another value!`;
    err = new AppError(
      message,
      STATUS_CODES.BAD_REQUEST,
      ERROR_CODES.DUPLICATE_KEY,
    );
  }

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((el) => el.message);
    const details = {};

    Object.keys(err.errors).forEach((field) => {
      details[field] = err.errors[field].message;
    });

    const message = `Invalid input data. ${errors.join(". ")}`;
    err = new AppError(
      message,
      STATUS_CODES.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      details,
    );
  }

  if (err.name === "JsonWebTokenError") {
    err = new AppError(
      "Invalid token. Please log in again.",
      STATUS_CODES.UNAUTHORIZED,
      ERROR_CODES.JWT_INVALID,
    );
  }

  if (err.name === "TokenExpiredError") {
    err = new AppError(
      "Token has expired. Please log in again.",
      STATUS_CODES.UNAUTHORIZED,
      ERROR_CODES.JWT_EXPIRED,
    );
  }

  if (err.name === "MulterError") {
    err = new AppError(
      err.message || "File upload error",
      STATUS_CODES.BAD_REQUEST,
      ERROR_CODES.UPLOAD_ERROR,
    );
  }

  if (err.stack) {
    console.log(err.stack);
  }

  let actor_user_id = req.user?.user_id || null;
  let actor_role = req.user?.user_type || "guest";

  if (!req.user) {
    try {
      let token;
      if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        token = req.headers.authorization.split(" ")[1];
      } else if (req.cookies && req.cookies.jwt) {
        token = req.cookies.jwt;
      }
      if (token) {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        if (decoded && decoded.role) {
          actor_user_id = decoded.user_id || null;
          actor_role = decoded.role || "guest";
        }
      }
    } catch (err) {
      // Silently fail if token is invalid
    }
  }

  logAuditEvent({
    level: "error",
    event_type: "http_error",
    action: `${req.method} ${req.originalUrl}`,
    method: req.method,
    path: req.originalUrl,
    status_code: err.statusCode,
    actor_user_id,
    actor_role,
    ip: req.ip,
    user_agent: req.get("user-agent") || null,
    error_message: err.message,
    error_code: err.errorCode || ERROR_CODES.SERVER_ERROR,
    error_details: sanitizeAuditBody(err.details || null),
  });

  const responsePayload = {
    success: false,
    status: err.status,
    message: err.message,
    errorCode: err.errorCode || ERROR_CODES.SERVER_ERROR,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  };

  if (err.details) {
    responsePayload.errors = err.details;
  }

  if (process.env.NODE_ENV === "development") {
    responsePayload.stack = err.stack;
    responsePayload.statusCode = err.statusCode;
  }

  res.status(err.statusCode).json(responsePayload);
};

module.exports = globalErrorHandler;
