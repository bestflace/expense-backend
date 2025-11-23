const bcrypt = require("bcrypt");
const pool = require("../db");
const { signToken } = require("../utils/jwt");
const crypto = require("crypto");
const SALT_ROUNDS = 10;

async function registerUser({ fullName, email, password }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const normalizedEmail = email.toLowerCase().trim();

    // check email tồn tại
    const existing = await client.query(
      "SELECT user_id FROM users WHERE email = $1",
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      const err = new Error("EMAIL_EXISTS");
      err.type = "EMAIL_EXISTS";
      throw err;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // tạo user
    const result = await client.query(
      `INSERT INTO users (user_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, user_name, email`,
      [fullName.trim(), normalizedEmail, passwordHash]
    );

    const user = result.rows[0];

    // tạo settings mặc định
    await client.query(
      `INSERT INTO settings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.user_id]
    );

    await client.query("COMMIT");

    const token = signToken({ userId: user.user_id });

    return {
      user: {
        id: user.user_id,
        fullName: user.user_name,
        email: user.email,
      },
      token,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505" || err.type === "EMAIL_EXISTS") {
      const e = new Error("EMAIL_EXISTS");
      e.type = "EMAIL_EXISTS";
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function loginUser({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query(
    `SELECT user_id, user_name, email, password_hash
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    const err = new Error("INVALID_CREDENTIALS");
    err.type = "INVALID_CREDENTIALS";
    throw err;
  }

  const user = result.rows[0];

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const err = new Error("INVALID_CREDENTIALS");
    err.type = "INVALID_CREDENTIALS";
    throw err;
  }

  const token = signToken({ userId: user.user_id });

  return {
    user: {
      id: user.user_id,
      fullName: user.user_name,
      email: user.email,
    },
    token,
  };
}

async function getUserById(userId) {
  console.log("🔎 getUserById được gọi với:", userId);
  const result = await pool.query(
    `SELECT user_id, user_name, email, phone, bio, avatar_url
     FROM users
     WHERE user_id = $1`,
    [userId]
  );
  console.log("📦 Kết quả SELECT users:", result.rows);
  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  return {
    id: user.user_id,
    fullName: user.user_name,
    email: user.email,
    phoneNumber: user.phone,
    bio: user.bio,
    avatarUrl: user.avatar_url,
  };
}
async function updateProfile(
  userId,
  { fullName, phoneNumber, bio, avatarUrl }
) {
  const result = await pool.query(
    `
    UPDATE users
    SET
      user_name   = COALESCE($2, user_name),
      phone       = COALESCE($3, phone),
      bio         = COALESCE($4, bio),
      avatar_url  = COALESCE($5, avatar_url),
      updated_at  = now()
    WHERE user_id = $1
    RETURNING user_id, user_name, email, phone, bio, avatar_url
    `,
    [
      userId,
      fullName ? fullName.trim() : null,
      phoneNumber || null,
      bio || null,
      avatarUrl || null,
    ]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  return {
    id: user.user_id,
    fullName: user.user_name,
    email: user.email,
    phoneNumber: user.phone,
    bio: user.bio,
    avatarUrl: user.avatar_url,
  };
}
async function startPasswordReset(email) {
  const normalizedEmail = email.toLowerCase().trim();

  const userRes = await pool.query(
    "SELECT user_id FROM users WHERE email = $1",
    [normalizedEmail]
  );

  // Vì lý do bảo mật: nếu không tồn tại email thì vẫn trả success
  if (userRes.rows.length === 0) {
    return null;
  }

  const userId = userRes.rows[0].user_id;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await pool.query(
    `
    INSERT INTO user_password_resets (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt]
  );

  // log mail (dev mode)
  await pool.query(
    `
    INSERT INTO email_logs (user_id, subject, content, status)
    VALUES ($1, $2, $3, 'sent')
    `,
    [userId, "Password reset", `DEV ONLY - Reset token: ${rawToken}`]
  );

  return { rawToken }; // chỉ trả về cho dev test
}

async function resetPasswordWithToken(rawToken, newPassword) {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const now = new Date();

  const resetRes = await pool.query(
    `
    SELECT reset_id, user_id
    FROM user_password_resets
    WHERE token_hash = $1
      AND status = 'pending'
      AND expires_at > $2
    LIMIT 1
    `,
    [tokenHash, now]
  );

  if (resetRes.rows.length === 0) {
    const err = new Error("TOKEN_INVALID_OR_EXPIRED");
    err.type = "TOKEN_INVALID_OR_EXPIRED";
    throw err;
  }

  const resetRow = resetRes.rows[0];
  const userId = resetRow.user_id;

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = now() WHERE user_id = $2",
    [passwordHash, userId]
  );

  await pool.query(
    `
    UPDATE user_password_resets
    SET status = 'used', used_at = now()
    WHERE reset_id = $1
    `,
    [resetRow.reset_id]
  );

  return { userId };
}

module.exports = {
  registerUser,
  loginUser,
  getUserById,
  updateProfile,
  startPasswordReset,
  resetPasswordWithToken,
};
