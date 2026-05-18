const express = require("express");
const router = express.Router();

const {
  createClinic,
  getPublicClinics,
  getBestClinics,
  getActiveClinicStaff,
  getClinicProfile,
  getClinicStats,
} = require("../controllers/clinic.Controller");

const { protect, restrictTo } = require("../middlewares/auth");
const { isClinicOwner } = require("../middlewares/isClinicOwner");
const {
  uploadSingle,
  uploadToCloudinary,
} = require("../middlewares/upload.Cloudinary");

router.post("/", uploadSingle("photo"), uploadToCloudinary, createClinic);
router.get("/", getPublicClinics);
router.get("/best", getBestClinics);
router.get("/:clinicId/staff", getActiveClinicStaff);
router.get("/:id/profile", getClinicProfile);
router.get("/my-stats", protect, restrictTo("clinic"), isClinicOwner, getClinicStats);

module.exports = router;
