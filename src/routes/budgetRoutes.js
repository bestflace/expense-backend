// src/routes/budgetRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const budgetController = require("../controllers/budgetController");

// tất cả đều cần login
router.use(authMiddleware);

// GET /api/budgets/current
router.get("/current", budgetController.getCurrentBudget);

// PUT /api/budgets/current
router.put("/current", budgetController.upsertCurrentBudget);

// (option) GET /api/budgets/history?months=6
router.get("/history", budgetController.listHistory);
// GET /api/budgets/alerts?days=30
router.get("/alerts", budgetController.listAlerts);
module.exports = router;
