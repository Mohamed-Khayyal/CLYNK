const express = require("express");
const adminController = require("../controllers/admin.Controller");
const auditController = require("../controllers/audit.Controller");
const auth = require("../middlewares/auth");
const { adminLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

router.use(auth.protect, auth.restrictTo("admin"), adminLimiter);

router.post("/create-admin", adminController.createAdmin);
router.get("/admins", adminController.getAllAdmins);
router.delete("/users/:id", adminController.deleteUser);
router.patch("/users/:id/undelete", adminController.undeleteUser);

router.get("/clinics", adminController.getClinics);
router.get("/pending-clinics", adminController.getPendingClinics);
router.get("/approved-clinics", adminController.getApprovedClinics);

router.patch("/clinics/:id/approve", adminController.approveClinic);
router.patch("/clinics/:id/reject", adminController.rejectClinic);
router.patch("/clinics/:id/unverify", adminController.unverifyClinic);

router.patch("/:id/verify", adminController.verifyDoctor);
router.patch("/:id/unverify", adminController.unverifyDoctor);

router.get("/doctors", adminController.getAllDoctors);
router.get("/verified-doctors", adminController.getVerifiedDoctors);
router.get("/unverified-doctors", adminController.getUnverifiedDoctors);

router.get("/staff", adminController.getAllStaff);
router.get("/verified-staff", adminController.getVerifiedStaff);
router.get("/unverified-staff", adminController.getUnverifiedStaff);
router.get("/bookings", adminController.getAllBookings);
router.get("/audit-logs", auditController.listAuditLogs);
router.delete("/audit-logs", auditController.clearAuditLogs);

router.get("/patients", adminController.getAllPatients);

router.get("/audit-stats", auditController.getAuditStats);
router.get("/admin-stats", adminController.adminStats);

module.exports = router;
