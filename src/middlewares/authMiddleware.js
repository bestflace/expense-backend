const { verifyToken } = require("../utils/jwt");

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      status: "error",
      message: "Thiếu token xác thực",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = verifyToken(token);
    const userId = payload.userId || payload.id || payload.user_id;

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Token không chứa userId hợp lệ",
      });
    }

    req.user = { id: userId };
    next();
  } catch (err) {
    console.error("authMiddleware verify error:", err);
    return res.status(401).json({
      status: "error",
      message: "Token không hợp lệ hoặc đã hết hạn",
    });
  }
}

module.exports = authMiddleware;
