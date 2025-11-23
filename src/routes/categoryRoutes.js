// src/routes/categoryRoutes.js
const express = require("express");
const auth = require("../middlewares/authMiddleware");
const categoryController = require("../controllers/categoryController");

const router = express.Router();

// Tất cả category API đều yêu cầu login
router.get("/", auth, categoryController.getMyCategories);
router.post("/", auth, categoryController.createCategory);
router.put("/:id", auth, categoryController.updateCategory);
router.delete("/:id", auth, categoryController.deleteCategory);

module.exports = router;
