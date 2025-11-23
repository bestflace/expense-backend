const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");

// Đăng ký
router.post("/register", authController.register);

// Đăng nhập
router.post("/login", authController.login);
// Quên mật khẩu
router.post("/forgot-password", authController.forgotPassword);
// Đặt lại mật khẩu
router.post("/reset-password", authController.resetPassword);
// Lấy thông tin user hiện tại
router.get("/me", authMiddleware, authController.me);
router.put("/me", authMiddleware, authController.updateProfile);
module.exports = router;
