const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./config/db.Config");
const corsHandler = require("./middlewares/cors.Handler");
const auditLogger = require("./middlewares/audit.Logger");

const AppError = require("./utilts/app.Error");
const errorHandler = require("./middlewares/error.Handler");

const authRoute = require("./routes/auth.Route");
const userRoute = require("./routes/user.Routes");
const clinicRoute = require("./routes/clinic.Routes");
const staffRoute = require("./routes/staff.Route");
const doctorRoute = require("./routes/doctor.Route");
const adminRoute = require("./routes/admin.Route");
const bookingRoute = require("./routes/booking.Route");
const notificationRoute = require("./routes/notification.Route");
const ratingRoute = require("./routes/rating.Route");
const prescriptionRoute = require("./routes/prescription.Route");

const {
  globalLimiter,
  authenticatedWriteLimiter,
} = require("./middlewares/rateLimiters");

process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! Shutting down...");
  console.log(err);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3001;

const getTrustProxySetting = () => {
  const value = process.env.TRUST_PROXY;
  if (!value) return "loopback, linklocal, uniquelocal";

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue >= 0) return numericValue;

  return value;
};

app.set("trust proxy", getTrustProxySetting());

app.use(corsHandler);
app.use(cookieParser());
app.use(globalLimiter);
app.use(authenticatedWriteLimiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(auditLogger);

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/clinic", clinicRoute);
app.use("/api/staff", staffRoute);
app.use("/api/doctors", doctorRoute);
app.use("/api/book", bookingRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/admin", adminRoute);
app.use("/api/ratings", ratingRoute);
app.use("/api/prescriptions", prescriptionRoute);

app.use((req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404));
});

app.use(errorHandler);

const startNoShowChecker = () => {
  const Booking = require("./models/Booking.model");
  // Run every 5 minutes
  setInterval(async () => {
    try {
      const now = new Date();
      const bookings = await Booking.find({
        status: { $in: ["pending", "confirmed"] },
      });

      for (const b of bookings) {
        if (!b.booking_date || !b.booking_from) continue;
        
        const startDateTime = new Date(`${b.booking_date}T${b.booking_from}:00`);
        if (isNaN(startDateTime.getTime())) continue;

        const cutoffTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

        if (now > cutoffTime) {
          console.log(`Auto-cancelling no-show booking ${b._id} (scheduled for ${b.booking_date} ${b.booking_from})`);
          b.status = "cancelled";
          b.prescription_access_status = "rejected";
          await b.save();

          try {
            const { createNotification } = require("./utilts/notification");
            await createNotification({
              user_id: b.patient_user_id,
              title: "تم إلغاء الحجز تلقائياً",
              message: "تم إلغاء حجزك لعدم الحضور في الموعد المحدد (مرور أكثر من 30 دقيقة).",
            });
          } catch (err) {
            console.error("Error creating no-show notification:", err.message);
          }
        }
      }
    } catch (error) {
      console.error("Error in no-show checker background job:", error);
    }
  }, 5 * 60 * 1000); // 5 minutes
};

let server;

const startServer = async () => {
  await connectDB();

  // Only listen to port if not running on Vercel (serverless)
  if (process.env.NODE_ENV !== "production") {
    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }

  startNoShowChecker();
};

startServer();

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! Shutting down...");
  console.log(err);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Export the app for Vercel Serverless Functions
module.exports = app;
