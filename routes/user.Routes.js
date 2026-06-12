const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth");
const userController = require("../controllers/user.Controller");
const {
  uploadFields,
  uploadToCloudinary,
} = require("../middlewares/upload.Cloudinary");

router.get("/me", auth.protect, userController.getMe);

router.patch(
  "/me",
  auth.protect,
  uploadFields([
    { name: "photo", maxCount: 1 },
    { name: "licence", maxCount: 1 },
  ]),
  uploadToCloudinary,
  userController.updateMe,
);

router.patch(
  "/change-password",
  auth.protect,
  userController.changePassword,
);

router.get(
  "/stats",
  userController.userStats
);

module.exports = router;
