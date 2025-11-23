// src/middlewares/errorHandler.js
function errorHandler(err, req, res, next) {
  console.error("❌ Error:", err);

  const status = err.status || 500;
  const message = err.message || "Internal server error";

  res.status(status).json({
    status: "error",
    message,
    // dev thì có thể trả thêm:
    // stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
}

module.exports = errorHandler;
