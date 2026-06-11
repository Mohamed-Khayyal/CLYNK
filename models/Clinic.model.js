const mongoose = require("mongoose");

const clinicSchema = new mongoose.Schema(
  {
    owner_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    verified_by_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    name: { type: String, required: true, unique: true, trim: true },
    address: { type: String, default: null },
    location: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, required: true, unique: true, lowercase: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    verified_at: { type: Date, default: null },
    licence: { type: String, default: null },
    geo_location: {
      type: { type: String, enum: ["Point"], default: null },
      coordinates: { type: [Number], default: null },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Clinic", clinicSchema);
