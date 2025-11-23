// src/routes/walletRoutes.js
const express = require("express");
const auth = require("../middlewares/authMiddleware");
const walletController = require("../controllers/walletController");

const router = express.Router();

// Tất cả route ví đều cần đăng nhập
router.get("/", auth, walletController.getMyWallets);
router.post("/", auth, walletController.createWallet);
router.put("/:id", auth, walletController.updateWallet);
router.delete("/:id", auth, walletController.deleteWallet);

module.exports = router;
