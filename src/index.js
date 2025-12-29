// src/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const errorHandler = require("./middlewares/errorHandler");
const pool = require("./db");
require("dotenv").config();

// load .env
dotenv.config();

const app = express();

// CORS – cho frontend Vite
// app.use(
//   cors({
//     origin: process.env.CLIENT_ORIGIN || "http://localhost:3001",
//     credentials: true,
//   })
// );
const allowedOrigins = [
  process.env.CLIENT_ORIGIN, // web vite (nếu có)
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:19006", // expo web/debug
  "http://127.0.0.1:19006",
];

app.use(
  cors({
    origin: (origin, cb) => {
      // origin undefined = requests từ mobile/native hoặc Postman
      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      // Cho phép mọi origin trong dev nếu bạn muốn nhanh:
      // return cb(null, true);

      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// test DB nhẹ nhàng (đã connect trong utils/db.js rồi)
app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT 1 as ok");
    res.json({ status: "ok", db: result.rows[0].ok });
  } catch (err) {
    res.status(500).json({ status: "error", message: "DB error" });
  }
});

// ====== ROUTES ======
const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const budgetRoutes = require("./routes/budgetRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");

// ====== USE======
app.use("/api/auth", authRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/chatbot", chatbotRoutes);
// Middleware handle lỗi đặt cuối cùng
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});

// Middleware bắt lỗi cuối cùng
// app.use((err, req, res, next) => {
//   console.error("Unhandled error:", err);

//   const status = err.status || 500;

//   res.status(status).json({
//     status: "error",
//     message: err.message || "Lỗi server",
//   });
// });
module.exports = app;
