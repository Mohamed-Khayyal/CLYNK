const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
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
    booking_date: { type: String, required: true }, // "YYYY-MM-DD"
    booking_from: { type: String, required: true }, // "HH:mm"
    booking_to: { type: String, required: true },   // "HH:mm"
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "rejected", "cancelled"],
      default: "pending",
    },
    prescription_access_status: {
      type: String,
      enum: ["not_requested", "pending", "accepted", "rejected"],
      default: "not_requested",
    },
    prescription_access_requested_at: { type: Date, default: null },
    prescription_access_responded_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Booking", bookingSchema);
