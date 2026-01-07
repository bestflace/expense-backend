// src/controllers/settingsController.js
const settingsService = require("../services/settingsService");

exports.getMySettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = await settingsService.getSettingsByUser(userId);

    res.json({
      status: "success",
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.updateMySettings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { darkMode, locale, timezone } = req.body;

    // validate nhẹ
    if (locale && !["vi-VN", "en-US"].includes(locale)) {
      return res.status(400).json({
        status: "error",
        message: "Locale không hợp lệ. Hỗ trợ 'vi-VN' hoặc 'en-US'.",
      });
    }

    const data = await settingsService.updateSettings(userId, {
      darkMode,
      locale,
      timezone,
    });

    res.json({
      status: "success",
      data,
    });
  } catch (err) {
    next(err);
  }
};
exports.updateMyAvatar = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res
        .status(400)
        .json({ status: "error", message: "Thiếu file avatar" });
    }

    // Lưu relative path vào DB
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const data = await settingsService.updateAvatarUrl(userId, avatarUrl);

    return res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};
