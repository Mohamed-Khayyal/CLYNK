const express = require("express");
const router = express.Router();

const { protect, restrictTo } = require("../middlewares/auth");
const { isClinicOwner } = require("../middlewares/isClinicOwner");
const {
  confirmDoctorPayment,
  confirmStaffPayment,
  confirmStaffSelfPayment,
  undoPayment,
  getDoctorFinancials,
  getClinicFinancials,
  getStaffFinancials,
  seedFinancials,
} = require("../controllers/payment.Controller");

// Doctor routes
router.post(
  "/doctor/bookings/:bookingId/confirm",
  protect,
  restrictTo("doctor"),
  confirmDoctorPayment
);

router.post(
  "/doctor/bookings/:bookingId/undo",
  protect,
  restrictTo("doctor"),
  undoPayment
);

router.get(
  "/doctor/financials",
  protect,
  restrictTo("doctor"),
  getDoctorFinancials
);

// Clinic routes
router.post(
  "/clinic/bookings/:bookingId/confirm",
  protect,
  restrictTo("clinic"),
  isClinicOwner,
  confirmStaffPayment
);

router.post(
  "/clinic/bookings/:bookingId/undo",
  protect,
  restrictTo("clinic"),
  isClinicOwner,
  undoPayment
);

router.get(
  "/clinic/financials",
  protect,
  restrictTo("clinic"),
  isClinicOwner,
  getClinicFinancials
);

// Staff routes
router.post(
  "/staff/bookings/:bookingId/confirm",
  protect,
  restrictTo("staff"),
  confirmStaffSelfPayment
);

router.post(
  "/staff/bookings/:bookingId/undo",
  protect,
  restrictTo("staff"),
  undoPayment
);

router.get(
  "/staff/financials",
  protect,
  restrictTo("staff"),
  getStaffFinancials
);

router.post(
  "/seed-financials",
  protect,
  restrictTo("clinic"),
  seedFinancials
);

module.exports = router;
