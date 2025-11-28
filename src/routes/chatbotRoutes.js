// src/routes/chatbotRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const chatbotController = require("../controllers/chatbotController");

router.use(authMiddleware);

router.post("/ask", chatbotController.ask);
router.get("/sessions", chatbotController.listSessions);
router.get("/sessions/:sessionId", chatbotController.getSession);

module.exports = router;
