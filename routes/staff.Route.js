const express = require("express");
const router = express.Router();

const {
  createStaffForClinic,
  getMyClinicStaff,
  verifyStaff,
  getPendingStaff,
  getStaffProfile,
  UnVerifyStaff,
} = require("../controllers/staff.Controller");

const { protect, restrictTo } = require("../middlewares/auth");
const { isClinicOwner } = require("../middlewares/isClinicOwner");

router.get("/:id/profile", getStaffProfile);

router.use(protect, restrictTo("clinic"), isClinicOwner);
router.post("/create", createStaffForClinic);
router.get("/pending", getPendingStaff);
router.get("/my-clinic", getMyClinicStaff);
router.patch("/:staffId/verify", verifyStaff);
router.patch("/:staffId/unverify", UnVerifyStaff);

module.exports = router;
