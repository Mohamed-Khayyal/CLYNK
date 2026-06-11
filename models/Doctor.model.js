const mongoose = require("mongoose");

const SPECIALISTS = [
  "مخ واعصاب",
  "عظام",
  "الأورام",
  "طب الأذن والأنف والحنجرة",
  "طب العيون",
  "قلب و اوعية دموية",
  "صدر و جهاز تنفسي",
  "كلى",
  "اسنان",
  "اطفال و حديثي الولادة",
  "جلدية",
  "نسا و توليد",
];

const doctorSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    full_name: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    licence: { type: String, default: null },
    gender: { type: String, enum: ["male", "female", null], default: null },
    specialist: { type: String, enum: [...SPECIALISTS, null], default: null },
    work_days: { type: String, default: null },
    work_from: { type: String, default: null },
    work_to: { type: String, default: null },
    location: { type: String, default: null },
    consultation_price: { type: Number, default: null },
    is_verified: { type: Boolean, default: false },
    years_of_experience: { type: Number, default: null },
    bio: { type: String, default: null },
    geo_location: {
      type: { type: String, enum: ["Point"], default: null },
      coordinates: { type: [Number], default: null },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Doctor", doctorSchema);
