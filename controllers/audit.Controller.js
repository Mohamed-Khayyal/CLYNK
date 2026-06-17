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

  const ip =
    typeof req.query.ip === "string" && req.query.ip.trim()
      ? req.query.ip.trim()
      : undefined;

  const dateFrom =
    typeof req.query.dateFrom === "string" && req.query.dateFrom.trim()
      ? req.query.dateFrom.trim()
      : undefined;

  const dateTo =
    typeof req.query.dateTo === "string" && req.query.dateTo.trim()
      ? req.query.dateTo.trim()
      : undefined;

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

  const logs = await getAuditLogs({
    limit,
    level,
    actor_user_id,
    actor_role,
    method,
    status_code,
    path_contains,
    location_contains,
    ip,
    dateFrom,
    dateTo,
  });

  res.status(200).json({
    status: "success",
    results: logs.length,
    data: { logs },
  });
});

exports.getAuditStats = catchAsync(async (req, res) => {
  const { getAuditLogs } = require("../utilts/audit.Logger");
  
  // Since we fetch logs from DB, we should just query it directly for stats,
  // but to keep it simple and consistent with the existing code, we will
  // fetch up to 100000 and count them. 
  // Alternatively, countDocuments could be added to audit.Logger.js for efficiency,
  // but we can start with this approach to maintain the same return format.
  const allLogs = await getAuditLogs({ limit: 100000 });
  const totalLogs = allLogs.length;

  let totalInfoLogs = 0;
  let totalErrorLogs = 0;
  let totalSuccessLogs = 0;
  let totalFailedLogs = 0;

  allLogs.forEach((log) => {
    if (log.level === "info") totalInfoLogs++;
    if (log.level === "error") totalErrorLogs++;
    if (log.status_code >= 200 && log.status_code < 400) totalSuccessLogs++;
    if (log.status_code >= 400) totalFailedLogs++;
  });

  res.status(200).json({
    status: "success",
    data: {
      total_logs: totalLogs,
      total_info_logs: totalInfoLogs,
      total_error_logs: totalErrorLogs,
      total_success_logs: totalSuccessLogs,
      total_failed_logs: totalFailedLogs,
    },
  });
});

exports.clearAuditLogs = catchAsync(async (req, res, next) => {
  const { clearAuditLogs } = require("../utilts/audit.Logger");
  await clearAuditLogs();
  
  res.status(200).json({
    status: "success",
    message: "Audit logs cleared successfully",
  });
});