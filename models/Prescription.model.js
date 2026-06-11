const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    booking_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
    },
    patient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
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
    patient_age: { type: Number, default: null },
    doctor_name: { type: String, default: null },
    specialty: { type: String, default: null },
    doctor_emergency_contact: { type: String, default: null },
    visit_date: { type: Date, default: () => new Date() },
    symptoms: { type: String, default: null },
    diagnosis: { type: String, default: null },
    medication_name: { type: String, default: null },
    dose: { type: String, default: null },
    duration: { type: String, default: null },
    test_name: { type: String, default: null },
    test_result: { type: String, default: null },
    test_date: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Prescription", prescriptionSchema);
