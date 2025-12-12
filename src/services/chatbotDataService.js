// src/services/chatbotDataService.js
const pool = require("../db");

/** Format Date -> 'YYYY-MM-DD' theo giờ local (không lệch timezone) */
function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/**
 * Tính khoảng ngày của một tháng (tháng hiện tại, tháng trước,...)
 * monthOffset = 0  => tháng này
 * monthOffset = -1 => tháng trước
 * monthOffset = 1  => tháng sau
 */
function getMonthRange(monthOffset = 0) {
  const now = new Date();

  // chuyển về chỉ số tháng tuyệt đối
  const baseMonthIndex = now.getFullYear() * 12 + now.getMonth() + monthOffset;
  const year = Math.floor(baseMonthIndex / 12);
  const month0 = baseMonthIndex % 12; // 0..11

  const start = new Date(year, month0, 1);
  const end = new Date(year, month0 + 1, 1);

  return {
    startDate: formatDateLocal(start), // YYYY-MM-DD
    endDate: formatDateLocal(end), // YYYY-MM-DD (đầu tháng kế tiếp)
    month: month0 + 1, // 1..12
    year,
  };
}

function formatMonthLabel(month, year) {
  return `tháng ${month}/${year}`;
}

/**
 * Tổng thu nhập + chi tiêu trong 1 tháng
 */
exports.getMonthlyIncomeExpense = async (userId, monthOffset = 0) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN c.type = 'income'  THEN t.amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN c.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    `,
    [userId, startDate, endDate]
  );

  return {
    ...result.rows[0],
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

// tổng chi trong 1 khoảng ngày bất kỳ
/**
 * Tổng chi tiêu (expense) trong một khoảng ngày [startDate, endDate)
 * startDate, endDate: 'YYYY-MM-DD'
 */
exports.getExpenseInRange = async (userId, startDate, endDate) => {
  const result = await pool.query(
    `
    SELECT
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    `,
    [userId, startDate, endDate]
  );

  return Number(result.rows[0].total_expense || 0);
};

/** Chi tiêu hôm nay (local VN) */
exports.getExpenseToday = async (userId) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const startDate = formatDateLocal(start);
  const endDate = formatDateLocal(end);

  return exports.getExpenseInRange(userId, startDate, endDate);
};

/** Chi tiêu 7 ngày gần nhất (bao gồm hôm nay) */
exports.getExpenseLast7Days = async (userId) => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // ngày mai
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6); // 6 ngày trước

  const startDate = formatDateLocal(start);
  const endDate = formatDateLocal(end);

  return exports.getExpenseInRange(userId, startDate, endDate);
};

/**
 * Ví chi nhiều nhất trong tháng (chỉ tính expense)
 */
exports.getTopSpendingWallet = async (userId, monthOffset = 0) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      w.wallet_id,
      w.wallet_name,
      w.balance,
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    JOIN wallets    w ON w.wallet_id    = t.wallet_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    GROUP BY w.wallet_id, w.wallet_name, w.balance
    ORDER BY total_expense DESC
    LIMIT 1
    `,
    [userId, startDate, endDate]
  );

  if (result.rowCount === 0) return null;

  return {
    ...result.rows[0],
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

/* Chi tiêu theo danh mục (array tên danh mục) trong 1 tháng*/
exports.getSpendingByCategoryNames = async (
  userId,
  namesLower,
  monthOffset = 0
) => {
  if (!namesLower || namesLower.length === 0) return [];

  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      c.category_id,
      c.category_name,
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
      AND lower(c.category_name) = ANY($4::text[])
    GROUP BY c.category_id, c.category_name
    ORDER BY total_expense DESC
    `,
    [userId, startDate, endDate, namesLower]
  );

  return {
    items: result.rows,
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

/**
 * Tổng số dư hiện tại (sum balance các ví chưa archived)
 */
exports.getTotalBalance = async (userId) => {
  const result = await pool.query(
    `
    SELECT COALESCE(SUM(balance), 0) AS total_balance
    FROM wallets
    WHERE user_id = $1
      AND is_archived = false
    `,
    [userId]
  );

  return Number(result.rows[0].total_balance) || 0;
};
/**
 * Top danh mục chi tiêu trong 1 tháng (mặc định 5 danh mục)
 */
exports.getTopExpenseCategories = async (
  userId,
  monthOffset = 0,
  limit = 5
) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      c.category_id,
      c.category_name,
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    GROUP BY c.category_id, c.category_name
    ORDER BY total_expense DESC
    LIMIT $4
    `,
    [userId, startDate, endDate, limit]
  );

  return {
    items: result.rows,
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

/**
 * Lấy thông tin 1 ví theo tên (LIKE %name%)
 */
exports.getWalletByName = async (userId, walletName) => {
  const result = await pool.query(
    `
    SELECT
      wallet_id,
      wallet_name,
      balance,
      type,
      color
    FROM wallets
    WHERE user_id = $1
      AND is_archived = false
      AND lower(wallet_name) LIKE lower($2)
    ORDER BY wallet_name
    LIMIT 1
    `,
    [userId, `%${walletName}%`]
  );

  if (result.rowCount === 0) return null;
  return result.rows[0];
};

/**
 * Top N giao dịch chi tiêu lớn nhất trong tháng
 */
exports.getTopBigExpenses = async (userId, monthOffset = 0, limit = 3) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      t.transaction_id,
      t.tx_date,
      t.amount,
      t.description,
      c.category_name,
      w.wallet_name
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    JOIN wallets    w ON w.wallet_id    = t.wallet_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    ORDER BY t.amount DESC
    LIMIT $4
    `,
    [userId, startDate, endDate, limit]
  );

  return {
    items: result.rows,
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

/**
 * Top N giao dịch thu nhập lớn nhất trong tháng
 */
exports.getTopBigIncomes = async (userId, monthOffset = 0, limit = 3) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      t.transaction_id,
      t.tx_date,
      t.amount,
      t.description,
      c.category_name,
      w.wallet_name
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    JOIN wallets    w ON w.wallet_id    = t.wallet_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'income'
      AND t.tx_date >= $2::date
      AND t.tx_date <  $3::date
    ORDER BY t.amount DESC
    LIMIT $4
    `,
    [userId, startDate, endDate, limit]
  );

  return {
    items: result.rows,
    startDate,
    endDate,
    month,
    year,
    label: formatMonthLabel(month, year),
  };
};

// Helper: lấy tháng/năm từ câu hỏi (đơn giản: tháng này / tháng trước / tháng số)
function detectMonthYearFromText(text) {
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();

  const lower = text.toLowerCase();

  // "tháng trước"
  if (lower.includes("tháng trước")) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    month = d.getMonth() + 1;
    year = d.getFullYear();
  } else {
    // "tháng 10", "tháng 11", ...
    const mMatch = lower.match(/tháng\s+(\d{1,2})/);
    if (mMatch) {
      const m = Number(mMatch[1]);
      if (m >= 1 && m <= 12) {
        month = m;
      }
    }
  }

  // "năm 2024"
  const yMatch = lower.match(/năm\s+(\d{4})/);
  if (yMatch) {
    year = Number(yMatch[1]);
  }

  return { month, year };
}

/**
 * Thông tin ngân sách tổng (không theo danh mục / ví) + chi tiêu thực tế trong tháng
 * monthOffset giống getMonthlyIncomeExpense: 0 = tháng này, -1 = tháng trước,...
 */
exports.getCurrentBudgetWithUsage = async (userId, monthOffset = 0) => {
  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    SELECT
      b.budget_id,
      b.month,
      b.limit_amount,
      b.alert_threshold,
      b.notify_in_app,
      b.notify_email,
      COALESCE(SUM(
        CASE WHEN c.type = 'expense' THEN t.amount ELSE 0 END
      ), 0) AS spent_amount
    FROM budgets b
    LEFT JOIN transactions t
      ON t.user_id = b.user_id
     AND t.deleted_at IS NULL
     AND t.tx_date >= $2::date
     AND t.tx_date <  $3::date
    LEFT JOIN categories c ON c.category_id = t.category_id
    WHERE b.user_id = $1
      AND b.category_id IS NULL
      AND b.wallet_id IS NULL
      AND b.month = $2::date
    GROUP BY
      b.budget_id,
      b.month,
      b.limit_amount,
      b.alert_threshold,
      b.notify_in_app,
      b.notify_email
    `,
    [userId, startDate, endDate]
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  const limitAmount = Number(row.limit_amount || 0);
  const spentAmount = Number(row.spent_amount || 0);
  const percentage = limitAmount > 0 ? (spentAmount / limitAmount) * 100 : null;

  return {
    budgetId: row.budget_id,
    month: row.month,
    limitAmount,
    spentAmount,
    percentage,
    alertThreshold: row.alert_threshold,
    notifyInApp: row.notify_in_app,
    notifyEmail: row.notify_email,
    label: formatMonthLabel(month, year),
  };
};

// 👉 HÀM MỚI: tổng chi tiêu theo 1 danh mục trong 1 tháng
async function getMonthlySpendingByCategory({ userId, text, categoryName }) {
  // xác định tháng/năm từ câu hỏi
  const { month, year } = detectMonthYearFromText(text || "");
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  // query DB
  const result = await pool.query(
    `
    SELECT
      COALESCE(SUM(t.amount), 0) AS total,
      MAX(c.category_name) AS category_name
    FROM transactions t
    JOIN categories c ON c.category_id = t.category_id
    WHERE t.user_id = $1
      AND t.deleted_at IS NULL
      AND c.type = 'expense'
      AND c.category_name ILIKE $4
      AND t.tx_date >= $2
      AND t.tx_date < $3
    `,
    [userId, start, end, `%${categoryName}%`]
  );

  const row = result.rows[0] || {};
  const total = Number(row.total || 0);

  return {
    month,
    year,
    categoryName: row.category_name || categoryName,
    total,
  };
}
