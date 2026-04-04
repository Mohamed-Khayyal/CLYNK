const express = require("express");
const ratingController = require("../controllers/rating.Controller");
const { protect, restrictTo } = require("../middlewares/auth");

const router = express.Router();

router.use(protect, restrictTo("patient"));

router.post("/doctor/:doctorId", ratingController.rateDoctor);

router.post("/clinic/:clinicId", ratingController.rateClinic);

router.get("/doctor/:doctorId", ratingController.getDoctorRatings);
router.get("/clinic/:clinicId", ratingController.getClinicRatings);

module.exports = router;
