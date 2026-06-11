const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    full_name: { type: String, required: true, trim: true },
    date_of_birth: { type: Date, default: null },
    gender: { type: String, enum: ["male", "female", null], default: null },
    phone: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Patient", patientSchema);
