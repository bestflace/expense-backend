// src/routes/transactionRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const transactionController = require("../controllers/transactionController");

// Tất cả routes dưới đây đều yêu cầu đăng nhập
router.use(authMiddleware);

// Lấy danh sách giao dịch (có filter)
router.get("/", transactionController.listTransactions);

// Tạo giao dịch mới
router.post("/", transactionController.createTransaction);

// Cập nhật giao dịch
router.put("/:id", transactionController.updateTransaction);

// Xoá mềm giao dịch
router.delete("/:id", transactionController.deleteTransaction);

module.exports = router;
