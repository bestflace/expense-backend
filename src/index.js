// src/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const errorHandler = require("./middlewares/errorHandler");
const pool = require("./db");

// load .env
dotenv.config();

const app = express();

// CORS – cho frontend Vite
app.use(
  cors({
    origin: "http://localhost:3000", // sau này có domain khác thì sửa
    credentials: true,
  })
);

app.use(express.json());

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

// ====== USE======
app.use("/api/auth", authRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/budgets", budgetRoutes);
// Middleware handle lỗi đặt cuối cùng
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
// Middleware bắt lỗi cuối cùng
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  const status = err.status || 500;

  res.status(status).json({
    status: "error",
    message: err.message || "Lỗi server",
  });
});
module.exports = app;
