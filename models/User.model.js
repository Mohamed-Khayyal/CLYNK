const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    password_reset_token: { type: String, default: null },
    password_reset_expires: { type: Date, default: null },
    password_reset_otp: { type: String, default: null },
    password_reset_otp_expires: { type: Date, default: null },
    photo: { type: String, default: null },
    user_type: {
      type: String,
      required: true,
      enum: ["patient", "doctor", "staff", "clinic", "admin"],
    },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("User", userSchema);
