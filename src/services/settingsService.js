// src/services/settingsService.js
const pool = require("../db");

// map 1 row về object FE
function mapSettingsRow(row) {
  if (!row) return null;
  return {
    darkMode: row.dark_mode,
    locale: row.locale, // 'vi-VN' | 'en-US'
    timezone: row.timezone, // ví dụ: 'Asia/Ho_Chi_Minh'
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Lấy settings, nếu chưa có thì tạo với default
async function getSettingsByUser(userId) {
  const { rows } = await pool.query(
    `SELECT dark_mode, locale, timezone, created_at, updated_at
     FROM settings
     WHERE user_id = $1`,
    [userId]
  );

  if (rows.length > 0) return mapSettingsRow(rows[0]);

  const insert = await pool.query(
    `INSERT INTO settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING dark_mode, locale, timezone, created_at, updated_at`,
    [userId]
  );

  if (insert.rows.length > 0) {
    return mapSettingsRow(insert.rows[0]);
  }

  // fallback siêu hiếm: có conflict nhưng đã có row → select lại
  const { rows: fallbackRows } = await pool.query(
    `SELECT dark_mode, locale, timezone, created_at, updated_at
     FROM settings
     WHERE user_id = $1`,
    [userId]
  );

  return mapSettingsRow(fallbackRows[0]);
}
async function updateAvatarUrl(userId, avatarUrl) {
  const { rows } = await pool.query(
    `UPDATE users
     SET avatar_url = $2, updated_at = now()
     WHERE user_id = $1
     RETURNING user_id, user_name, email, phone, bio, avatar_url`,
    [userId, avatarUrl]
  );

  return rows[0];
}

// Cập nhật dark_mode + locale (+ timezone nếu muốn)
async function updateSettings(userId, payload) {
  const { darkMode, locale, timezone } = payload;

  const { rows } = await pool.query(
    `INSERT INTO settings (user_id, dark_mode, locale, timezone)
     VALUES ($1, COALESCE($2,false), COALESCE($3,'vi-VN'), COALESCE($4,'Asia/Ho_Chi_Minh'))
     ON CONFLICT (user_id) DO UPDATE
       SET dark_mode = COALESCE($2, settings.dark_mode),
           locale    = COALESCE($3, settings.locale),
           timezone  = COALESCE($4, settings.timezone),
           updated_at = now()
     RETURNING dark_mode, locale, timezone, created_at, updated_at`,
    [userId, darkMode, locale, timezone]
  );

  return mapSettingsRow(rows[0]);
}

module.exports = {
  getSettingsByUser,
  updateSettings,
  updateAvatarUrl,
};
