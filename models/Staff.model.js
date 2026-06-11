const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    clinic_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    full_name: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    gender: { type: String, enum: ["male", "female", null], default: null },
    specialist: { type: String, default: null },
    work_days: { type: String, default: null },
    work_from: { type: String, default: null },
    work_to: { type: String, default: null },
    consultation_price: { type: Number, default: null },
    is_verified: { type: Boolean, default: false },
    years_of_experience: { type: Number, default: null },
    bio: { type: String, default: null },
    location: { type: String, default: null },
    licence: { type: String, default: null },
    geo_location: {
      type: { type: String, enum: ["Point"], default: null },
      coordinates: { type: [Number], default: null },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Staff", staffSchema);
