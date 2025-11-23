// src/controllers/budgetController.js
const budgetService = require("../services/budgetService");

exports.getCurrentBudget = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const budget = await budgetService.getCurrentBudget(userId);

    res.json({
      status: "success",
      data: budget, // có thể null nếu chưa set
    });
  } catch (err) {
    next(err);
  }
};

exports.upsertCurrentBudget = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const payload = req.body;

    try {
      const budget = await budgetService.upsertCurrentBudget(userId, payload);
      res.json({
        status: "success",
        data: budget,
      });
    } catch (err) {
      if (err.type === "LIMIT_INVALID") {
        return res.status(400).json({
          status: "error",
          message: "Hạn mức phải là số > 0",
        });
      }
      if (err.type === "THRESHOLD_INVALID") {
        return res.status(400).json({
          status: "error",
          message: "Ngưỡng cảnh báo chỉ cho phép: 70, 80, 90 hoặc 100",
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.listHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const months = req.query.months || 6;

    const history = await budgetService.listBudgetHistory(userId, months);
    res.json({
      status: "success",
      data: history,
    });
  } catch (err) {
    next(err);
  }
};
