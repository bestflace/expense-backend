// src/controllers/categoryController.js
const categoryService = require("../services/categoryService");

exports.getMyCategories = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type } = req.query; // optional ?type=income/expense

    const categories = await categoryService.getCategories(userId, type);

    res.json({
      status: "success",
      data: categories,
    });
  } catch (err) {
    next(err);
  }
};

exports.createCategory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const payload = req.body;

    const category = await categoryService.createCategory(userId, payload);

    res.status(201).json({
      status: "success",
      data: category,
    });
  } catch (err) {
    next(err);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const categoryId = req.params.id;
    const payload = req.body;

    const category = await categoryService.updateCategory(
      userId,
      categoryId,
      payload
    );

    res.json({
      status: "success",
      data: category,
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const categoryId = req.params.id;

    await categoryService.deleteCategory(userId, categoryId);

    res.json({
      status: "success",
      message: "Xóa danh mục thành công",
    });
  } catch (err) {
    next(err);
  }
};
