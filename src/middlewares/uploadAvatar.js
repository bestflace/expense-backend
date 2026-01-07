const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext)
      ? ext
      : ".png";
    cb(null, `u_${req.user.id}_${Date.now()}${safeExt}`);
  },
});

function fileFilter(req, file, cb) {
  const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
  if (!ok) return cb(new Error("Chỉ hỗ trợ PNG/JPG/WEBP"));
  cb(null, true);
}

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
