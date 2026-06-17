const AuditLog = require("../models/AuditLog.model");

const SENSITIVE_KEYS = new Set([
  "password",
  "new_password",
  "confirm_password",
  "token",
  "refresh_token",
  "jwt",
  "authorization",
  "cookie",
]);

const truncateText = (value, max = 500) => {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated]`;
};

const sanitizeAuditBody = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[depth-limited]";

  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeAuditBody(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, 40);

    for (const [key, nested] of entries) {
      const lowered = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowered)) {
        output[key] = "[redacted]";
      } else {
        output[key] = sanitizeAuditBody(nested, depth + 1);
      }
    }

    return output;
  }

  return truncateText(value);
};

const logAuditEvent = async (event) => {
  try {
    const level = event?.level === "error" ? "error" : "info";
    const payload = event && typeof event === "object" ? event : {};
    
    await AuditLog.create({
      ...payload,
      level,
    });
  } catch (error) {
    // Silently fail logging rather than breaking the application
    console.error("Failed to save audit log to MongoDB:", error);
  }
};

const getAuditLogs = async ({
  limit = 1000,
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
} = {}) => {
  const query = {};

  if (level) query.level = level;
  if (actor_user_id !== undefined) query.actor_user_id = actor_user_id;
  if (actor_role !== undefined) query.actor_role = String(actor_role || "guest");
  if (method) query.method = { $regex: new RegExp(`^${method}$`, "i") };
  if (status_code !== undefined) query.status_code = Number(status_code);
  if (path_contains) query.path = { $regex: new RegExp(path_contains, "i") };
  if (ip) query.ip = { $regex: new RegExp(ip, "i") };
  
  if (location_contains) {
    const regex = new RegExp(location_contains, "i");
    query.$or = [
      { "ip_location.city": { $regex: regex } },
      { "ip_location.region": { $regex: regex } },
      { "ip_location.country": { $regex: regex } }
    ];
  }

  if (dateFrom || dateTo) {
    query.timestamp = {};
    if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
    if (dateTo) query.timestamp.$lte = new Date(dateTo);
  }

  const logs = await AuditLog.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();

  return logs;
};

const clearAuditLogs = async () => {
  try {
    await AuditLog.deleteMany({});
  } catch (error) {
    console.error("Failed to clear audit logs:", error);
  }
};

module.exports = {
  logAuditEvent,
  getAuditLogs,
  sanitizeAuditBody,
  clearAuditLogs,
};
