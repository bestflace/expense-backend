// src/routes/settingsRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const settingsController = require("../controllers/settingsController");

// cần đăng nhập
router.use(authMiddleware);

// GET /api/settings
router.get("/", settingsController.getMySettings);

// PUT /api/settings
router.put("/", settingsController.updateMySettings);

module.exports = router;
