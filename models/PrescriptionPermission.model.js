const mongoose = require("mongoose");

const prescriptionPermissionSchema = new mongoose.Schema(
  {
    patient_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    doctor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },
    staff_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
    },
    status: {
      type: String,
      enum: ["accepted", "revoked"],
      default: "accepted",
    },
    accepted_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

module.exports = mongoose.model("PrescriptionPermission", prescriptionPermissionSchema);
