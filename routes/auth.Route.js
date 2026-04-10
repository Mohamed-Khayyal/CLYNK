const express = require("express");
const authController = require("../controllers/auth.Controller");
const auth = require("../middlewares/auth");
const { authLimiter } = require("../middlewares/rateLimiters");
const {
  signupValidation,
  loginValidation,
  refreshValidation,
} = require("../middlewares/auth.Validation");

const router = express.Router();

router.post("/signup", authLimiter, signupValidation, authController.signup);
router.post("/login", authLimiter, loginValidation, authController.login);

router.post(
  "/refresh",
  authLimiter,
  refreshValidation,
  authController.refreshToken,
);

router.post("/logout", auth.protect, authController.logout);

module.exports = router;
