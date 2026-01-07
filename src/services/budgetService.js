// src/services/budgetService.js
const pool = require("../db");
const { sendBudgetAlertEmail } = require("./emailService");

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
function normalizeMonthDate(input) {
  const now = new Date();

  if (!input) {
    // không truyền gì -> lấy tháng hiện tại
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  if (input instanceof Date) {
    return new Date(input.getFullYear(), input.getMonth(), 1);
  }

  if (typeof input === "string") {
    // hỗ trợ "YYYY-MM-DD" hoặc "YYYY-MM-DDT..."
    const onlyDate = input.slice(0, 10);
    const [yStr, mStr] = onlyDate.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (y && m) {
      return new Date(y, m - 1, 1);
    }
  }

  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  // fallback
  return new Date(now.getFullYear(), now.getMonth(), 1);
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

  // Tháng hiện tại (dùng chung cho SELECT / INSERT)
  const monthExpr = `date_trunc('month', CURRENT_DATE)::date`;

  // Kiểm tra đã có budget global tháng này chưa
  const { rows: existingRows } = await pool.query(
    `
    SELECT *
    FROM budgets
    WHERE user_id = $1
      AND month = ${monthExpr}
      AND category_id IS NULL
      AND wallet_id IS NULL
    LIMIT 1
    `,
    [userId]
  );

  let budgetRow;

  if (existingRows.length === 0) {
    // Chưa có → INSERT
    const { rows } = await pool.query(
      `
      INSERT INTO budgets (
        user_id, category_id, wallet_id, month,
        limit_amount, alert_threshold, notify_in_app, notify_email
      )
      VALUES (
        $1, NULL, NULL,
        ${monthExpr},
        $2, $3,
        COALESCE($4, false),
        COALESCE($5, false)
      )
      RETURNING *
      `,
      [userId, limit, alertThreshold, notifyInApp, notifyEmail]
    );
    budgetRow = rows[0];
  } else {
    // Đã có → UPDATE
    const existing = existingRows[0];
    const { rows } = await pool.query(
      `
      UPDATE budgets
      SET
        limit_amount   = $2,
        alert_threshold = $3,
        notify_in_app  = COALESCE($4, notify_in_app),
        notify_email   = COALESCE($5, notify_email),
        updated_at     = now()
      WHERE budget_id = $1
      RETURNING *
      `,
      [existing.budget_id, limit, alertThreshold, notifyInApp, notifyEmail]
    );
    budgetRow = rows[0];
  }

  // Sau khi update xong, tính luôn % đã dùng rồi trả về
  const current = await getCurrentBudget(userId);

  // đề phòng getCurrentBudget trả null (không nên)
  return (
    current ||
    mapBudgetRow(budgetRow, {
      spentThisMonth: 0,
      percentage: 0,
      isOverLimit: false,
      isOverThreshold: false,
    })
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
/**
 * Check & log cảnh báo khi user tạo/sửa/xoá/khôi phục giao dịch
 *
 * ✅ Hỗ trợ:
 *  - userId: bắt buộc
 *  - arg2: có thể là targetDate (Date | string) HOẶC client (pool client)
 *  - arg3: nếu truyền, là client
 *
 * => Tương thích ngược:
 *  - checkAndLogBudgetAlertsForUser(userId)              // dùng tháng hiện tại
 *  - checkAndLogBudgetAlertsForUser(userId, client)      // dùng client, tháng hiện tại
 *  - checkAndLogBudgetAlertsForUser(userId, txDate)      // dùng tháng của giao dịch
 *  - checkAndLogBudgetAlertsForUser(userId, txDate, client)
 */
async function checkAndLogBudgetAlertsForUser(userId, arg2, arg3) {
  let targetDate = null;
  let client = pool;

  // arg2 có thể là date hoặc client
  if (arg2) {
    if (typeof arg2.query === "function") {
      // arg2 là client
      client = arg2;
    } else {
      // arg2 là ngày (Date | string)
      targetDate = arg2;
    }
  }

  // arg3 nếu truyền thêm thì chắc chắn là client
  if (arg3 && typeof arg3.query === "function") {
    client = arg3;
  }

  // 🔹 Lấy ngày đầu tháng của tháng cần check (tháng giao dịch)
  // 🔹 Lấy ngày đầu tháng của tháng cần check (tháng giao dịch)
  const monthDate = normalizeMonthDate(targetDate);

  // Lấy YYYY-MM-01 theo local time, tránh lệch timezone
  const y = monthDate.getFullYear();
  const m = String(monthDate.getMonth() + 1).padStart(2, "0");
  const monthDateStr = `${y}-${m}-01`; // ví dụ: "2025-02-01"

  // 1. Lấy budget của tháng đó có bật notify
  const { rows: budgetRows } = await client.query(
    `
    SELECT *
    FROM budgets
    WHERE user_id = $1
      AND month = date_trunc('month', $2::date)::date
      AND category_id IS NULL
      AND wallet_id IS NULL
      AND (notify_in_app = true OR notify_email = true)
    LIMIT 1
    `,
    [userId, monthDateStr]
  );

  if (budgetRows.length === 0) return; // chưa set hạn mức cho tháng này

  const b = budgetRows[0];

  // 2. Tính tổng chi tiêu trong THÁNG CỦA GIAO DỊCH
  const { rows: spendRows } = await client.query(
    `
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= date_trunc('month', $2::date)::date
      AND t.tx_date <  (date_trunc('month', $2::date) + interval '1 month')::date
    `,
    [userId, monthDateStr]
  );

  const spent = Number(spendRows[0].total);
  const limit = Number(b.limit_amount);
  if (limit <= 0) return;

  const percentage = (spent / limit) * 100;

  // 3. Nếu chưa qua ngưỡng nào thì thôi
  if (percentage < b.alert_threshold && percentage < 100) return;

  // 4. Chuẩn bị ngưỡng cần log
  const thresholdsToLog = new Set();
  if (percentage >= b.alert_threshold) thresholdsToLog.add(b.alert_threshold);
  if (percentage >= 100) thresholdsToLog.add(101); // 101 = vượt 100%

  // ngày hôm nay (log / gửi mail theo NGÀY hiện tại, đúng yêu cầu "1 ngày")
  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd

  // Lấy thông tin user để gửi email
  let userEmail = null;
  let userFullName = null;
  if (b.notify_email) {
    const { rows: userRows } = await client.query(
      `SELECT email, user_name FROM users WHERE user_id = $1`,
      [userId]
    );
    if (userRows.length > 0) {
      userEmail = userRows[0].email;
      userFullName = userRows[0].user_name || "bạn";
    }
  }

  // label tháng đúng với tháng của giao dịch
  const monthLabelVi = monthDate.toLocaleDateString("vi-VN", {
    month: "long",
    year: "numeric",
  });

  for (const thr of thresholdsToLog) {
    // 4.1. Log in-app (chỉ để lưu lịch sử)
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

    // 4.2. Log + gửi EMAIL, chỉ 1 lần / ngày / ngưỡng
    if (b.notify_email && userEmail) {
      const { rows: emailLogRows } = await client.query(
        `
        INSERT INTO budget_alert_logs (
          user_id, budget_id, threshold, sent_on, channel
        )
        VALUES ($1, $2, $3, $4, 'email')
        ON CONFLICT (user_id, budget_id, threshold, sent_on, channel)
        DO NOTHING
        RETURNING user_id
        `,
        [userId, b.budget_id, thr, today]
      );

      // rows.length > 0 nghĩa là vừa INSERT mới → gửi email
      if (emailLogRows.length > 0) {
        const subject =
          thr === 101
            ? "[BudgetF] Cảnh báo: Bạn đã vượt 100% ngân sách tháng"
            : `[BudgetF] Cảnh báo: Chi tiêu đạt ${Math.round(
                percentage
              )}% ngân sách tháng`;

        const spentStr = spent.toLocaleString("vi-VN");
        const limitStr = limit.toLocaleString("vi-VN");

        const html = `
          <p>Xin chào ${userFullName},</p>
          <p>Hệ thống BudgetF ghi nhận chi tiêu tháng <strong>${monthLabelVi}</strong> của bạn đã đạt mức:</p>
          <p><strong>${spentStr}₫ / ${limitStr}₫ (${percentage.toFixed(
          0
        )}%)</strong></p>
          <p>Ngưỡng cảnh báo bạn đặt: <strong>${
            b.alert_threshold
          }%</strong>.</p>
          ${
            thr === 101
              ? "<p><strong>Lưu ý:</strong> Bạn đã vượt quá 100% hạn mức ngân sách tháng.</p>"
              : ""
          }
          <p>Bạn nên xem lại các khoản chi và điều chỉnh ngân sách nếu cần.</p>
          <p>Trân trọng,<br/>BudgetF</p>
        `;

        const text = `Xin chào ${userFullName}, chi tiêu tháng ${monthLabelVi} của bạn đã đạt ${spentStr}₫ / ${limitStr}₫ (${percentage.toFixed(
          0
        )}%). Ngưỡng cảnh báo: ${b.alert_threshold}%.`;

        sendBudgetAlertEmail({ to: userEmail, subject, html, text }).catch(
          (err) => {
            console.error("sendBudgetAlertEmail error:", err);
          }
        );
      }
    }
  }
}

function mapAlertRow(row) {
  if (!row) return null;
  return {
    id: row.budget_alert_log_id, // nếu bảng dùng tên khác (vd id) thì sửa lại chỗ này
    budgetId: row.budget_id,
    threshold: row.threshold, // 70 | 80 | 90 | 100 | 101 (101 = vượt 100%)
    sentOn: row.sent_on, // DATE
    channel: row.channel, // 'in_app' | 'email'
    month: row.month, // tháng của budget
    limitAmount: Number(row.limit_amount),
    budgetAlertThreshold: row.alert_threshold, // ngưỡng cấu hình trong budget
    createdAt: row.created_at,
  };
}

/**
 * Lấy các log cảnh báo ngân sách gần đây
 * @param userId
 * @param days số ngày gần đây, default 30
 */
async function listBudgetAlerts(userId, days = 30) {
  const d = Math.max(1, Math.min(365, Number(days) || 30));

  const { rows } = await pool.query(
    `
    SELECT 
      l.budget_alert_log_id ,
      l.user_id,
      l.budget_id,
      l.threshold,
      l.sent_on,
      l.channel,
      l.created_at,
      b.month,
      b.limit_amount,
      b.alert_threshold
    FROM budget_alert_logs l
    JOIN budgets b ON b.budget_id = l.budget_id
    WHERE l.user_id = $1
      AND l.sent_on >= CURRENT_DATE - $2 * INTERVAL '1 day'
    ORDER BY l.sent_on DESC, l.threshold DESC
    `,
    [userId, d]
  );

  return rows.map(mapAlertRow);
}

module.exports = {
  getCurrentBudget,
  upsertCurrentBudget,
  listBudgetHistory,
  checkAndLogBudgetAlertsForUser,
  listBudgetAlerts,
};
