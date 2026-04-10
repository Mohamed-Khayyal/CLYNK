const { createRateLimiter, getRequestUserId } = require("./rateLimit");

const parsePositiveNumber = (value, fallback) => {
  const parsedValue = Number(value);

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return fallback;
};

exports.globalLimiter = createRateLimiter({
  name: "global",
  windowMs: parsePositiveNumber(
    process.env.RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
  ),
  max: parsePositiveNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  message: "Too many requests from this user. Please try again later.",
});

exports.authLimiter = createRateLimiter({
  name: "auth",
  windowMs: parsePositiveNumber(
    process.env.AUTH_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
  ),
  max: parsePositiveNumber(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10),
  message: "Too many authentication requests. Please try again later.",
});

exports.writeLimiter = createRateLimiter({
  name: "write",
  windowMs: parsePositiveNumber(
    process.env.WRITE_RATE_LIMIT_WINDOW_MS,
    10 * 60 * 1000,
  ),
  max: parsePositiveNumber(process.env.WRITE_RATE_LIMIT_MAX_REQUESTS, 20),
  message: "Too many write requests from this user. Please slow down.",
});

exports.adminLimiter = createRateLimiter({
  name: "admin",
  windowMs: parsePositiveNumber(
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS,
    15 * 60 * 1000,
  ),
  max: parsePositiveNumber(process.env.ADMIN_RATE_LIMIT_MAX, 50),
  message: "Too many admin requests from this user. Please try again later.",
});

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

exports.authenticatedWriteLimiter = (req, res, next) => {
  if (!mutatingMethods.has(req.method)) {
    return next();
  }

  if (!getRequestUserId(req)) {
    return next();
  }

  return exports.writeLimiter(req, res, next);
};
