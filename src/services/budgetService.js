// src/services/budgetService.js
const pool = require("../db");

/**
 * Helper: map 1 row budget -> object trả về cho FE
 */
function mapBudgetRow(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.budget_id,
    month: row.month, // Date
    limitAmount: Number(row.limit_amount),
    alertThreshold: row.alert_threshold, // 70 | 80 | 90 | 100
    notifyInApp: row.notify_in_app,
    notifyEmail: row.notify_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

/**
 * Lấy budget tháng hiện tại (global – tất cả chi tiêu, mọi ví)
 * + tính tổng chi tiêu tháng và % đã dùng
 */
async function getCurrentBudget(userId) {
  // 1. Lấy budget global (category_id NULL, wallet_id NULL) của tháng hiện tại
  const { rows: budgetRows } = await pool.query(
    `
    SELECT *
    FROM budgets
    WHERE user_id = $1
      AND month = date_trunc('month', CURRENT_DATE)::date
      AND category_id IS NULL
      AND wallet_id IS NULL
    LIMIT 1
    `,
    [userId]
  );

  if (budgetRows.length === 0) {
    return null; // user chưa set hạn mức
  }

  const b = budgetRows[0];

  // 2. Tính tổng chi tiêu tháng này (chỉ expense, chưa bị soft delete)
  const { rows: spendRows } = await pool.query(
    `
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= date_trunc('month', CURRENT_DATE)::date
      AND t.tx_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    `,
    [userId]
  );

  const spent = Number(spendRows[0].total);
  const limit = Number(b.limit_amount);
  const percentage = limit > 0 ? (spent / limit) * 100 : 0;

  const isOverThreshold = percentage >= b.alert_threshold;
  const isOverLimit = spent > limit;

  return mapBudgetRow(b, {
    spentThisMonth: spent,
    percentage,
    isOverThreshold,
    isOverLimit,
  });
}

/**
 * Tạo / cập nhật budget tháng hiện tại (global)
 * payload: { limitAmount, alertThreshold, notifyInApp, notifyEmail }
 */
async function upsertCurrentBudget(userId, payload) {
  const {
    limitAmount,
    alertThreshold = 80,
    notifyInApp,
    notifyEmail,
  } = payload;

  const limit = Number(limitAmount);
  if (!Number.isFinite(limit) || limit <= 0) {
    const err = new Error("LIMIT_INVALID");
    err.type = "LIMIT_INVALID";
    throw err;
  }

  const allowedThresholds = [70, 80, 90, 100];
  if (!allowedThresholds.includes(Number(alertThreshold))) {
    const err = new Error("THRESHOLD_INVALID");
    err.type = "THRESHOLD_INVALID";
    throw err;
  }

  const { rows } = await pool.query(
    `
    INSERT INTO budgets (
      user_id, category_id, wallet_id, month,
      limit_amount, alert_threshold, notify_in_app, notify_email
    )
    VALUES (
      $1, NULL, NULL,
      date_trunc('month', CURRENT_DATE)::date,
      $2, $3,
      COALESCE($4,false),
      COALESCE($5,false)
    )
    ON CONFLICT (user_id, category_key, wallet_key, month)
    DO UPDATE SET
      limit_amount   = EXCLUDED.limit_amount,
      alert_threshold = EXCLUDED.alert_threshold,
      notify_in_app  = EXCLUDED.notify_in_app,
      notify_email   = EXCLUDED.notify_email,
      updated_at     = now()
    RETURNING *
    `,
    [userId, limit, alertThreshold, notifyInApp, notifyEmail]
  );

  // Sau khi update xong, tính luôn % đã dùng rồi trả về
  const budgetRow = rows[0];

  const current = await getCurrentBudget(userId);
  // dùng thông tin mới nếu getCurrentBudget trả null (không nên)
  return (
    current || mapBudgetRow(budgetRow, { spentThisMonth: 0, percentage: 0 })
  );
}

/**
 * (Option) Lịch sử budget vài tháng gần đây
 */
async function listBudgetHistory(userId, months = 6) {
  const m = Math.max(1, Math.min(24, Number(months) || 6));

  const { rows } = await pool.query(
    `
    SELECT *
    FROM budgets
    WHERE user_id = $1
      AND category_id IS NULL
      AND wallet_id IS NULL
    ORDER BY month DESC
    LIMIT $2
    `,
    [userId, m]
  );

  return rows.map((row) => mapBudgetRow(row));
}

/**
 * Check & log cảnh báo khi user tạo/sửa/xoá giao dịch
 * (để không spam lỗi, việc log lỗi không throw ra ngoài)
 */
async function checkAndLogBudgetAlertsForUser(userId, client = pool) {
  // lấy budget hiện tại
  const { rows: budgetRows } = await client.query(
    `
    SELECT *
    FROM budgets
    WHERE user_id = $1
      AND month = date_trunc('month', CURRENT_DATE)::date
      AND category_id IS NULL
      AND wallet_id IS NULL
      AND (notify_in_app = true OR notify_email = true)
    LIMIT 1
    `,
    [userId]
  );

  if (budgetRows.length === 0) return; // chưa set hạn mức

  const b = budgetRows[0];

  const { rows: spendRows } = await client.query(
    `
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= date_trunc('month', CURRENT_DATE)::date
      AND t.tx_date <  (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
    `,
    [userId]
  );

  const spent = Number(spendRows[0].total);
  const limit = Number(b.limit_amount);
  if (limit <= 0) return;

  const percentage = (spent / limit) * 100;

  // Nếu chưa qua ngưỡng → không cảnh báo
  if (percentage < b.alert_threshold && percentage < 100) return;

  // Ngưỡng muốn log: ngưỡng người dùng chọn + nếu vượt 100% thì thêm 101
  const thresholdsToLog = new Set();
  if (percentage >= b.alert_threshold) thresholdsToLog.add(b.alert_threshold);
  if (percentage >= 100) thresholdsToLog.add(101); // 101 = vượt 100%

  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd

  for (const thr of thresholdsToLog) {
    if (b.notify_in_app) {
      await client.query(
        `
        INSERT INTO budget_alert_logs (
          user_id, budget_id, threshold, sent_on, channel
        )
        VALUES ($1, $2, $3, $4, 'in_app')
        ON CONFLICT (user_id, budget_id, threshold, sent_on, channel)
        DO NOTHING
        `,
        [userId, b.budget_id, thr, today]
      );
    }

    // TODO: nếu dùng email thực sự thì thêm log channel = 'email' + gửi mail
  }
}

module.exports = {
  getCurrentBudget,
  upsertCurrentBudget,
  listBudgetHistory,
  checkAndLogBudgetAlertsForUser,
};
