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
const bokkingRoute = require("./routes/booking.Route");
const notificationRoute = require("./routes/notification.Route");
const ratingRoute = require("./routes/rating.Route");

const { globalLimiter } = require("./middlewares/rateLimiters");

process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! Shutting down...");
  console.log(err);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(corsHandler);
app.use(globalLimiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
app.use(auditLogger);

connectDB();

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/clinic", clinicRoute);
app.use("/api/staff", staffRoute);
app.use("/api/doctors", doctorRoute);
app.use("/api/book", bokkingRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/admin", adminRoute);
app.use("/api/ratings", ratingRoute);

app.use((req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404));
});

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! Shutting down...");
  console.log(err);
  server.close(() => process.exit(1));
});
