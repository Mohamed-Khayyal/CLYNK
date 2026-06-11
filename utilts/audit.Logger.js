const fs = require("fs");
const path = require("path");
const { createLogger, format, transports } = require("winston");

const logsDir = process.env.NODE_ENV === "production" 
  ? path.join("/tmp", "logs") 
  : path.resolve(process.cwd(), "logs");
const auditLogPath = path.join(logsDir, "audit.log");
const auditInfoLogPath = path.join(logsDir, "audit.info.log");
const auditErrorLogPath = path.join(logsDir, "audit.error.log");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const onlyLevel = (level) =>
  format((info) => {
    return info.level === level ? info : false;
  });

const auditLogger = createLogger({
  levels: {
    error: 0,
    info: 1,
  },
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
    format.json(),
  ),
  transports: [
    new transports.File({
      filename: auditInfoLogPath,
      level: "info",
      format: format.combine(
        onlyLevel("info")(),
        format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
        format.json(),
      ),
    }),
    new transports.File({
      filename: auditErrorLogPath,
      level: "error",
      format: format.combine(
        onlyLevel("error")(),
        format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
        format.json(),
      ),
    }),
    new transports.File({
      filename: auditLogPath,
    }),
  ],
});

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

const logAuditEvent = (event) => {
  const level = event?.level === "error" ? "error" : "info";
  const payload = event && typeof event === "object" ? event : {};
  auditLogger.log({
    ...payload,
    level,
  });
};

const parseLogLines = (text) => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const events = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      continue;
    }
  }

  return events;
};

const getAuditLogs = ({
  limit = 1000,
  level,
  actor_user_id,
  actor_role,
  method,
  status_code,
  path_contains,
  location_contains,
} = {}) => {
  if (!fs.existsSync(auditLogPath)) {
    return [];
  }

  const text = fs.readFileSync(auditLogPath, "utf8");
  const parsed = parseLogLines(text);

  const filtered = parsed.filter((entry) => {
    if (level && entry.level !== level) {
      return false;
    }

    if (actor_user_id !== undefined && entry.actor_user_id !== actor_user_id) {
      return false;
    }

    if (actor_role !== undefined && String(entry.actor_role || "guest") !== actor_role) {
      return false;
    }

    if (method && String(entry.method || "").toUpperCase() !== method) {
      return false;
    }

    if (status_code !== undefined && Number(entry.status_code) !== status_code) {
      return false;
    }

    if (
      path_contains &&
      !String(entry.path || "").toLowerCase().includes(path_contains.toLowerCase())
    ) {
      return false;
    }

    if (location_contains) {
      const loc = entry.ip_location || {};
      const needle = location_contains.toLowerCase();
      const haystack = [
        loc.city || "",
        loc.region || "",
        loc.country || "",
      ].join(" ").toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    return true;
  });

  return filtered.slice(-limit).reverse();
};

module.exports = {
  logAuditEvent,
  getAuditLogs,
  sanitizeAuditBody,
};
