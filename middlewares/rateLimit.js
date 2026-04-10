const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const AppError = require("../utilts/app.Error");
const ERROR_CODES = require("../utilts/error.Codes");

const parseCookieHeader = (cookieHeader = "") =>
  cookieHeader.split(";").reduce((cookies, cookiePart) => {
    const [rawName, ...rawValueParts] = cookiePart.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValueParts.join("="));
    return cookies;
  }, {});

const getRequestCookies = (req) => {
  if (req.cookies && typeof req.cookies === "object") {
    return req.cookies;
  }

  return parseCookieHeader(req.headers.cookie);
};

const getCandidateTokens = (req) => {
  const tokens = [];
  const authorization = req.headers.authorization;

  if (authorization && authorization.startsWith("Bearer ")) {
    tokens.push(authorization.split(" ")[1]);
  }

  const cookies = getRequestCookies(req);

  if (cookies.jwt) {
    tokens.push(cookies.jwt);
  }

  if (cookies.refresh_token) {
    tokens.push(cookies.refresh_token);
  }

  return [...new Set(tokens.filter(Boolean))];
};

const verifyToken = (token, secret) => {
  if (!token || !secret) {
    return null;
  }

  try {
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
};

const getRequestUserId = (req) => {
  if (req.user?.user_id) {
    return req.user.user_id;
  }

  const candidateTokens = getCandidateTokens(req);

  for (const token of candidateTokens) {
    const accessPayload = verifyToken(token, process.env.JWT_SECRET);

    if (accessPayload?.user_id) {
      return accessPayload.user_id;
    }

    const refreshPayload = verifyToken(token, process.env.JWT_REFRESH_SECRET);

    if (refreshPayload?.user_id) {
      return refreshPayload.user_id;
    }
  }

  return null;
};

const getRateLimitKey = (req) => {
  const userId = getRequestUserId(req);

  if (userId) {
    return `user:${userId}`;
  }

  return `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown")}`;
};

exports.getRequestUserId = getRequestUserId;
exports.getRateLimitKey = getRateLimitKey;

exports.createRateLimiter = ({
  windowMs,
  max,
  name = "default",
  message = "Too many requests, please try again later.",
  skip,
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getRateLimitKey(req),
    skip,
    handler: (req, res, next) => {
      const retryAfterSeconds = req.rateLimit?.resetTime
        ? Math.max(
            1,
            Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000),
          )
        : Math.ceil(windowMs / 1000);

      next(
        new AppError(message, 429, ERROR_CODES.RATE_LIMIT_EXCEEDED, {
          limiter: name,
          maxRequests: max,
          windowMs,
          retryAfterSeconds,
          scope: getRequestUserId(req) ? "user" : "ip",
        }),
      );
    },
  });
