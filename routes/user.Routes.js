const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const userController = require("../controllers/user.Controller");
const {
  uploadSingle,
  uploadToCloudinary,
} = require("../middlewares/upload.Cloudinary");

router.get("/me", auth.protect, userController.getMe);

router.patch(
  "/me",
  auth.protect,
  uploadSingle("photo"),
  uploadToCloudinary,
  userController.updateMe,
);

router.get(
  "/stats",
  userController.userStats
);

module.exports = router;
