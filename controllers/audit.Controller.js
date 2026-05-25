const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const { getAuditLogs } = require("../utilts/audit.Logger");

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_LEVELS = new Set(["info", "error"]);
const ALLOWED_ROLES = new Set(["patient", "doctor", "staff", "clinic", "admin", "guest"]);

exports.listAuditLogs = catchAsync(async (req, res, next) => {
  const rawLimit = Number(req.query.limit);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 1000;

  const rawActorId = req.query.actor_user_id;
  let actor_user_id;
  if (rawActorId !== undefined) {
    actor_user_id = Number(rawActorId);
    if (!Number.isInteger(actor_user_id) || actor_user_id <= 0) {
      return next(new AppError("actor_user_id must be a positive integer", 400));
    }
  }

  let method;
  if (req.query.method) {
    method = String(req.query.method).toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return next(new AppError("method must be one of GET, POST, PUT, PATCH, DELETE", 400));
    }
  }

  let status_code;
  if (req.query.status_code !== undefined) {
    status_code = Number(req.query.status_code);
    if (!Number.isInteger(status_code) || status_code < 100 || status_code > 599) {
      return next(new AppError("status_code must be a valid HTTP status code", 400));
    }
  }

  const path_contains =
    typeof req.query.path_contains === "string" && req.query.path_contains.trim()
      ? req.query.path_contains.trim()
      : undefined;

  const location_contains =
    typeof req.query.location_contains === "string" && req.query.location_contains.trim()
      ? req.query.location_contains.trim()
      : undefined;

  let level;
  if (req.query.level !== undefined) {
    level = String(req.query.level).toLowerCase().trim();
    if (!ALLOWED_LEVELS.has(level)) {
      return next(new AppError("level must be one of info or error", 400));
    }
  }

  let actor_role;
  if (req.query.actor_role !== undefined) {
    actor_role = String(req.query.actor_role).toLowerCase().trim();
    if (!ALLOWED_ROLES.has(actor_role)) {
      return next(
        new AppError(
          "actor_role must be one of patient, doctor, staff, clinic, admin, guest",
          400,
        ),
      );
    }
  }

  const logs = getAuditLogs({
    limit,
    level,
    actor_user_id,
    actor_role,
    method,
    status_code,
    path_contains,
    location_contains,
  });

  res.status(200).json({
    status: "success",
    results: logs.length,
    logs,
  });
});

exports.getAuditStats = catchAsync(async (req, res) => {
  const totalLogs = getAuditLogs({ limit: 100000 }).length;
  const totalInfoLogs = getAuditLogs({ level: "info", limit: 100000 }).length;
  const totalErrorLogs = getAuditLogs({ level: "error", limit: 100000 }).length;
  const totalSuccessLogs = totalLogs - totalErrorLogs;
  const totalFailedLogs = totalLogs - totalSuccessLogs;

  res.status(200).json({
    status: "success",
    stats: {
      total_logs: totalLogs,
      total_info_logs: totalInfoLogs,
      total_error_logs: totalErrorLogs,
      total_success_logs: totalSuccessLogs,
      total_failed_logs: totalFailedLogs,
    },
  });
});