// src/services/transactionService.js
const pool = require("../db");
const budgetService = require("./budgetService"); // 👈 đã import đúng

/**
 * Tạo giao dịch mới
 */
async function createTransaction(userId, payload) {
  const { categoryId, walletId, amount, description, txDate } = payload;

  if (!categoryId || !walletId || !amount) {
    const err = new Error("MISSING_FIELDS");
    err.type = "MISSING_FIELDS";
    throw err;
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    const err = new Error("INVALID_AMOUNT");
    err.type = "INVALID_AMOUNT";
    throw err;
  }

  const result = await pool.query(
    `INSERT INTO transactions (user_id, category_id, wallet_id, amount, description, tx_date)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE))
     RETURNING transaction_id, user_id, category_id, wallet_id, amount, description, tx_date`,
    [
      userId,
      categoryId,
      walletId,
      parsedAmount,
      description || null,
      txDate || null,
    ]
  );

  const tx = result.rows[0];

  // 👉 SAU KHI TẠO GIAO DỊCH: kiểm tra budget (không chặn response nếu lỗi)
  budgetService
    .checkAndLogBudgetAlertsForUser(userId, tx.tx_date)
    .catch((err) =>
      console.error("check budget alert error (createTransaction):", err)
    );

  return tx;
}

/**
 * Lấy danh sách giao dịch của user (có filter đơn giản)
 */
async function listTransactions(userId, options = {}) {
  const {
    fromDate,
    toDate,
    walletId,
    categoryId,
    q,
    limit = 50,
    offset = 0,
  } = options;

  const params = [userId];
  const where = [`t.user_id = $1`, `t.deleted_at IS NULL`];

  if (fromDate) {
    params.push(fromDate);
    where.push(`t.tx_date >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`t.tx_date <= $${params.length}`);
  }
  if (walletId) {
    params.push(walletId);
    where.push(`t.wallet_id = $${params.length}`);
  }
  if (categoryId) {
    params.push(categoryId);
    where.push(`t.category_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(t.description ILIKE $${params.length})`);
  }

  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT
      t.transaction_id,
      t.amount,
      t.description,
      t.tx_date,
      t.wallet_id,
      t.category_id,
      c.category_name,
      c.type AS category_type,
      c.icon,
      c.color
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE ${where.join(" AND ")}
    ORDER BY t.tx_date DESC, t.transaction_id DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const result = await pool.query(sql, params);
  return result.rows;
}

/**
 * Lấy chi tiết 1 transaction
 */
async function getTransactionById(userId, transactionId) {
  const result = await pool.query(
    `
    SELECT
      t.transaction_id,
      t.amount,
      t.description,
      t.tx_date,
      t.wallet_id,
      t.category_id,
      c.category_name,
      c.type AS category_type,
      c.icon,
      c.color
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.transaction_id = $1
      AND t.user_id = $2
      AND t.deleted_at IS NULL
    `,
    [transactionId, userId]
  );

  return result.rows[0] || null;
}

/**
 * Cập nhật giao dịch
 */
async function updateTransaction(userId, transactionId, payload) {
  const existing = await getTransactionById(userId, transactionId);
  if (!existing) {
    const err = new Error("NOT_FOUND");
    err.type = "NOT_FOUND";
    throw err;
  }

  const fields = [];
  const params = [];
  let idx = 1;

  if (payload.categoryId !== undefined) {
    fields.push(`category_id = $${idx++}`);
    params.push(payload.categoryId);
  }
  if (payload.walletId !== undefined) {
    fields.push(`wallet_id = $${idx++}`);
    params.push(payload.walletId);
  }
  if (payload.amount !== undefined) {
    const parsedAmount = Number(payload.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      const err = new Error("INVALID_AMOUNT");
      err.type = "INVALID_AMOUNT";
      throw err;
    }
    fields.push(`amount = $${idx++}`);
    params.push(parsedAmount);
  }
  if (payload.description !== undefined) {
    fields.push(`description = $${idx++}`);
    params.push(payload.description);
  }
  if (payload.txDate !== undefined) {
    fields.push(`tx_date = $${idx++}`);
    params.push(payload.txDate);
  }

  if (fields.length === 0) {
    return existing; // không có gì để update
  }

  params.push(transactionId);
  params.push(userId);

  const sql = `
    UPDATE transactions
    SET ${fields.join(", ")}, updated_at = now()
    WHERE transaction_id = $${idx++} AND user_id = $${idx}
    RETURNING transaction_id, tx_date
  `;

  // ✅ Thực thi UPDATE trong DB
  const { rows } = await pool.query(sql, params);
  if (rows.length === 0) {
    const err = new Error("NOT_FOUND");
    err.type = "NOT_FOUND";
    throw err;
  }

  const updatedRow = rows[0];
  const targetDate = payload.txDate || updatedRow.tx_date || existing.tx_date;

  // ✅ Kiểm tra lại budget theo THÁNG của giao dịch
  budgetService
    .checkAndLogBudgetAlertsForUser(userId, targetDate)
    .catch((err) =>
      console.error("check budget alert error (updateTransaction):", err)
    );

  // trả lại bản mới
  return await getTransactionById(userId, transactionId);
}

/**
 * Xoá mềm giao dịch
 */
async function softDeleteTransaction(userId, transactionId) {
  const result = await pool.query(
    `
  UPDATE transactions
  SET deleted_at = now(), updated_at = now()
  WHERE transaction_id = $1 AND user_id = $2 AND deleted_at IS NULL
  RETURNING transaction_id, tx_date
  `,
    [transactionId, userId]
  );

  if (result.rowCount === 0) {
    const err = new Error("NOT_FOUND");
    err.type = "NOT_FOUND";
    throw err;
  }

  const deletedTx = result.rows[0];

  // trigger DB đã rollback ví, giờ check lại budget (tháng của giao dịch)
  budgetService
    .checkAndLogBudgetAlertsForUser(userId, deletedTx.tx_date)
    .catch((err) =>
      console.error("check budget alert error (softDeleteTransaction):", err)
    );

  return { success: true };
}

module.exports = {
  createTransaction,
  listTransactions,
  getTransactionById,
  updateTransaction,
  softDeleteTransaction,
};
