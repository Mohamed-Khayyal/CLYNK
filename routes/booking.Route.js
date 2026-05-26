const express = require("express");
const router = express.Router();

const { protect, restrictTo } = require("../middlewares/auth");
const {
  createBooking,
  createProviderBooking,
  getMyBookings,
  getAvailableSlots,
  cancelBooking,
  getClinicBookings,
  cancelClinicBooking,
} = require("../controllers/booking.Controller");
const { isClinicOwner } = require("../middlewares/isClinicOwner");

router.post("/", protect, restrictTo("patient"), createBooking);
router.post(
  "/provider",
  protect,
  restrictTo("doctor", "staff"),
  createProviderBooking,
);
router.get(
  "/my-bookings",
  protect,
  restrictTo("doctor", "staff", "patient"),
  getMyBookings,
);

router.get(
  "/clinic-bookings",
  protect,
  restrictTo("clinic"),
  isClinicOwner,
  getClinicBookings
);

router.get("/slots", getAvailableSlots);

router.patch(
  "/clinic-bookings/:id/cancel",
  protect,
  restrictTo("clinic"),
  isClinicOwner,
  cancelClinicBooking
);

router.patch(
  "/:id/cancel",
  protect,
  restrictTo("doctor", "staff", "patient"),
  cancelBooking,
);

module.exports = router;
