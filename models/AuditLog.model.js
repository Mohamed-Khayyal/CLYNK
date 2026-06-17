const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  event_type: { type: String, required: true },
  action: { type: String, required: true },
  method: { type: String },
  path: { type: String },
  status_code: { type: Number },
  duration_ms: { type: Number },
  
  actor_user_id: { type: String },
  actor_name: { type: String },
  actor_email: { type: String },
  actor_role: { type: String, default: "guest" },

  ip: { type: String },
  request_ip: { type: String },
  ip_location: {
    city: String,
    region: String,
    country: String,
    latitude: Number,
    longitude: Number,
    map_url: String,
    source: String,
  },

  user_agent: { type: String },
  client_hints: {
    model: String,
    platform: String,
    platformVersion: String,
    mobile: String,
    uaList: String,
  },
  query: { type: mongoose.Schema.Types.Mixed },
  body: { type: mongoose.Schema.Types.Mixed },

  level: { type: String, enum: ["info", "error", "warn", "debug"], default: "info" },
  timestamp: { type: Date, default: Date.now }
});

// Indexes for fast querying in admin dashboard
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ level: 1 });
auditLogSchema.index({ actor_role: 1 });
auditLogSchema.index({ status_code: 1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
module.exports = AuditLog;
