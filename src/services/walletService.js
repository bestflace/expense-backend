// src/services/walletService.js
const pool = require("../db");

// Map 1 row DB -> object trả về cho FE
function mapWalletRow(row) {
  return {
    id: row.wallet_id,
    name: row.wallet_name,
    description: row.description,
    icon: row.icon,
    type: row.type,
    balance: Number(row.balance),
    color: row.color,
    isArchived: row.is_archived,
    createdAt: row.created_at,
  };
}

async function getWalletsByUser(userId) {
  const sql = `
    SELECT *
    FROM wallets
    WHERE user_id = $1
      AND is_archived = false
    ORDER BY wallet_id ASC
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows.map(mapWalletRow);
}

async function createWallet(userId, payload) {
  // chấp nhận name, wallet_name, walletName
  let name = payload.name || payload.wallet_name || payload.walletName || "";
  const color = payload.color || "#4ECDC4";
  name = name.trim();
  if (!name) {
    const err = new Error("Tên ví là bắt buộc");
    err.status = 400;
    throw err;
  }

  const description = payload.description;
  const icon = payload.icon;
  const type = payload.type || "standard";

  const initialBalance = payload.balance != null ? Number(payload.balance) : 0;

  if (initialBalance < 0) {
    const err = new Error("Số dư ban đầu không được âm");
    err.status = 400;
    throw err;
  }

  const sql = `
    INSERT INTO wallets (user_id, wallet_name, description, icon, type, balance, color)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [
    userId,
    name,
    description || null,
    icon || null,
    type,
    initialBalance,
    color,
  ]);

  return mapWalletRow(rows[0]);
}

async function updateWallet(userId, walletId, updates) {
  const { name, description, icon, type, balance, color } = updates;

  // kiểm tra ví có thuộc user không
  const { rows: existedRows } = await pool.query(
    "SELECT * FROM wallets WHERE wallet_id = $1 AND user_id = $2",
    [walletId, userId]
  );
  if (existedRows.length === 0) {
    const err = new Error("Không tìm thấy ví");
    err.status = 404;
    throw err;
  }

  const current = existedRows[0];

  if (balance != null && Number(balance) < 0) {
    const err = new Error("Số dư không được âm");
    err.status = 400;
    throw err;
  }

  const sql = `
    UPDATE wallets
    SET wallet_name = $1,
        description = $2,
        icon        = $3,
        type        = $4,
        balance     = $5,
        color       = $6,
        updated_at  = now()
    WHERE wallet_id = $7 AND user_id = $8
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [
    name != null ? name : current.wallet_name,
    description != null ? description : current.description,
    icon != null ? icon : current.icon,
    type != null ? type : current.type,
    balance != null ? Number(balance) : current.balance,
    color != null ? color : current.color,
    walletId,
    userId,
  ]);

  return mapWalletRow(rows[0]);
}

async function deleteWallet(userId, walletId) {
  // kiểm tra có transaction nào dùng ví này không
  const { rows: txRows } = await pool.query(
    `
      SELECT 1 
      FROM transactions 
      WHERE wallet_id = $1 
        AND user_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [walletId, userId]
  );

  if (txRows.length > 0) {
    const err = new Error(
      "Không thể xóa ví vì đang có giao dịch liên quan. Vui lòng xoá / chuyển giao dịch trước."
    );
    err.status = 400;
    throw err;
  }

  // xóa cứng luôn (hoặc set is_archived = true tuỳ chiến lược)
  const { rowCount } = await pool.query(
    "DELETE FROM wallets WHERE wallet_id = $1 AND user_id = $2",
    [walletId, userId]
  );

  if (rowCount === 0) {
    const err = new Error("Không tìm thấy ví");
    err.status = 404;
    throw err;
  }

  return true;
}

module.exports = {
  getWalletsByUser,
  createWallet,
  updateWallet,
  deleteWallet,
};
