// src/services/chatbotDataService.js
const pool = require("../db");
function getCurrentMonthYearVN(timeZone = "Asia/Ho_Chi_Minh") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function getMonthRangeByMonthYear(month, year) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return {
    startDate: formatDateLocal(start),
    endDate: formatDateLocal(end),
    month,
    year,
    label: formatMonthLabel(month, year),
  };
}

// Thay getMonthRange(monthOffset) hiện tại bằng bản “theo VN”
function getMonthRange(monthOffset = 0) {
  const { month, year } = getCurrentMonthYearVN();
  const currentIndex = year * 12 + (month - 1);
  const targetIndex = currentIndex + monthOffset;

  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth0 = ((targetIndex % 12) + 12) % 12;

  return getMonthRangeByMonthYear(targetMonth0 + 1, targetYear);
}

/** Format Date -> 'YYYY-MM-DD' theo giờ local (không lệch timezone) */
function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  if (!namesLower || namesLower.length === 0)
    return { items: [], label: "", month: null, year: null };

  const { startDate, endDate, month, year } = getMonthRange(monthOffset);

  const result = await pool.query(
    `
    WITH RECURSIVE seed AS (
      SELECT category_id
      FROM categories
      WHERE type = 'expense'
        AND (user_id IS NULL OR user_id = $1)
        AND lower(category_name) = ANY($4::text[])
    ),
    tree AS (
      SELECT s.category_id AS category_id, s.category_id AS root_id
      FROM seed s
      UNION ALL
      SELECT c.category_id, t.root_id
      FROM categories c
      JOIN tree t ON c.parent_category_id = t.category_id
    )
    SELECT
      root.category_id,
      root.category_name,
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM seed s
    JOIN categories root ON root.category_id = s.category_id
    LEFT JOIN tree tr ON tr.root_id = s.category_id
    LEFT JOIN transactions t
      ON t.category_id = tr.category_id
     AND t.user_id = $1
     AND t.deleted_at IS NULL
     AND t.tx_date >= $2::date
     AND t.tx_date <  $3::date
    GROUP BY root.category_id, root.category_name
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
exports.getMonthlyIncomeExpenseByMonthYear = async (userId, month, year) => {
  const { startDate, endDate, label } = getMonthRangeByMonthYear(month, year);

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
    month,
    year,
    startDate,
    endDate,
    label,
  };
};

exports.getCurrentBudgetWithUsageByMonthYear = async (userId, month, year) => {
  const { startDate, endDate, label } = getMonthRangeByMonthYear(month, year);

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
    label,
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
// ====== FUZZY HELPERS (VN accent-insensitive + punctuation-insensitive) ======
function normalizeLoose(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ") // bỏ ký tự lạ, gạch nối...
    .trim()
    .replace(/\s+/g, " ");
}

function bigrams(s) {
  const x = normalizeLoose(s).replace(/\s+/g, "");
  const out = [];
  for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;

  const map = new Map();
  for (const g of A) map.set(g, (map.get(g) || 0) + 1);

  let intersection = 0;
  for (const g of B) {
    const n = map.get(g) || 0;
    if (n > 0) {
      intersection++;
      map.set(g, n - 1);
    }
  }
  return (2 * intersection) / (A.length + B.length);
}

function bestMatch(query, candidates, minScore = 0.45) {
  const q = normalizeLoose(query);
  if (!q) return null;

  let best = null;

  for (const c of candidates) {
    const name = c.name;
    const n = normalizeLoose(name);

    // boost các case “chắc chắn”
    let score = 0;
    if (n === q) score = 1;
    else if (n.includes(q) || q.includes(n)) score = 0.9;
    else score = diceCoefficient(q, n);

    if (!best || score > best.score) best = { ...c, score };
  }

  if (!best || best.score < minScore) return null;
  return best;
}

// ====== DATE RANGE HELPERS ======
// Tool truyền vào YYYY-MM-DD (end_date hiểu là INCLUSIVE theo kiểu người dùng)
function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getRangeLabel(startDate, endDateInclusive) {
  return `từ ${startDate} đến ${endDateInclusive}`;
}

// ====== LOAD CANDIDATES ======
async function listAccessibleExpenseCategories(userId) {
  const result = await pool.query(
    `
    SELECT category_id, category_name, parent_category_id
    FROM categories
    WHERE type = 'expense'
      AND (user_id IS NULL OR user_id = $1)
    ORDER BY category_name
    `,
    [userId]
  );

  return result.rows.map((r) => ({
    id: Number(r.category_id),
    name: r.category_name,
    parentId: r.parent_category_id ? Number(r.parent_category_id) : null,
  }));
}

async function listWallets(userId) {
  const result = await pool.query(
    `
    SELECT wallet_id, wallet_name
    FROM wallets
    WHERE user_id = $1
      AND is_archived = false
    ORDER BY wallet_name
    `,
    [userId]
  );

  return result.rows.map((r) => ({
    id: Number(r.wallet_id),
    name: r.wallet_name,
  }));
}

// ====== RESOLVE FUZZY ======
exports.resolveCategoryIdsFuzzy = async (userId, categoryNames = []) => {
  const candidates = await listAccessibleExpenseCategories(userId);
  const resolved = [];
  const unresolved = [];

  for (const rawName of categoryNames) {
    const m = bestMatch(rawName, candidates);
    if (!m) unresolved.push(rawName);
    else
      resolved.push({
        input: rawName,
        categoryId: m.id,
        categoryName: m.name,
        score: m.score,
      });
  }

  // loại trùng categoryId
  const uniq = new Map();
  for (const r of resolved) uniq.set(r.categoryId, r);
  return { resolved: [...uniq.values()], unresolved };
};

exports.resolveWalletIdsFuzzy = async (userId, walletNames = []) => {
  const candidates = await listWallets(userId);
  const resolved = [];
  const unresolved = [];

  for (const rawName of walletNames) {
    const m = bestMatch(rawName, candidates, 0.5);
    if (!m) unresolved.push(rawName);
    else
      resolved.push({
        input: rawName,
        walletId: m.id,
        walletName: m.name,
        score: m.score,
      });
  }

  const uniq = new Map();
  for (const r of resolved) uniq.set(r.walletId, r);
  return { resolved: [...uniq.values()], unresolved };
};

// ====== CORE QUERY: spending by category roots (option include sub) + range + wallet filter ======
async function spendingByRootCategoryIdsInRange({
  userId,
  rootCategoryIds,
  startDate,
  endDateExclusive,
  walletIds = null,
  includeSubcategories = true,
}) {
  if (!rootCategoryIds?.length) return [];

  // walletIds null => không lọc ví
  const walletParam = walletIds?.length ? walletIds : null;

  if (!includeSubcategories) {
    const result = await pool.query(
      `
      SELECT
        c.category_id AS root_id,
        c.category_name AS root_name,
        COALESCE(SUM(t.amount), 0) AS total_expense
      FROM categories c
      LEFT JOIN transactions t
        ON t.user_id = $1
       AND t.deleted_at IS NULL
       AND t.category_id = c.category_id
       AND t.tx_date >= $3::date
       AND t.tx_date <  $4::date
       AND ($5::bigint[] IS NULL OR t.wallet_id = ANY($5::bigint[]))
      WHERE c.category_id = ANY($2::bigint[])
        AND c.type = 'expense'
        AND (c.user_id IS NULL OR c.user_id = $1)
      GROUP BY c.category_id, c.category_name
      ORDER BY total_expense DESC
      `,
      [userId, rootCategoryIds, startDate, endDateExclusive, walletParam]
    );
    return result.rows;
  }

  // include subcategories: recursive CTE mang root_id xuống cây con
  const result = await pool.query(
    `
    WITH RECURSIVE cat_tree AS (
      SELECT
        c.category_id,
        c.category_id AS root_id
      FROM categories c
      WHERE c.category_id = ANY($2::bigint[])
        AND c.type = 'expense'
        AND (c.user_id IS NULL OR c.user_id = $1)

      UNION ALL

      SELECT
        child.category_id,
        ct.root_id
      FROM categories child
      JOIN cat_tree ct ON child.parent_category_id = ct.category_id
      WHERE child.type = 'expense'
        AND (child.user_id IS NULL OR child.user_id = $1)
    )
    SELECT
      ct.root_id,
      r.category_name AS root_name,
      COALESCE(SUM(t.amount), 0) AS total_expense
    FROM cat_tree ct
    JOIN categories r ON r.category_id = ct.root_id
    LEFT JOIN transactions t
      ON t.user_id = $1
     AND t.deleted_at IS NULL
     AND t.category_id = ct.category_id
     AND t.tx_date >= $3::date
     AND t.tx_date <  $4::date
     AND ($5::bigint[] IS NULL OR t.wallet_id = ANY($5::bigint[]))
    GROUP BY ct.root_id, r.category_name
    ORDER BY total_expense DESC
    `,
    [userId, rootCategoryIds, startDate, endDateExclusive, walletParam]
  );

  return result.rows;
}

// ====== TOOL-FRIENDLY WRAPPER: one function for Gemini ======
/**
 * Tool: get_spending_by_categories
 * - category_names: ["an uong", "di lai"]
 * - (A) monthOffset: 0/-1/...  OR  (B) start_date & end_date (inclusive)
 * - wallet_names OR wallet_ids: lọc theo 1 hoặc nhiều ví
 * - include_subcategories: default true
 * - currency: hiện tại app 1 tiền tệ -> default VND (chủ yếu để format phía assistant)
 */
exports.getSpendingByCategories = async ({
  userId,
  category_names = [],
  monthOffset = null,
  start_date = null,
  end_date = null, // inclusive
  wallet_names = [],
  wallet_ids = [],
  include_subcategories = true,
  currency = "VND",
}) => {
  // 1) resolve wallet ids (optional)
  let walletIdsFinal = Array.isArray(wallet_ids)
    ? wallet_ids.map(Number).filter(Boolean)
    : [];
  let walletResolveInfo = { resolved: [], unresolved: [] };

  if (
    !walletIdsFinal.length &&
    Array.isArray(wallet_names) &&
    wallet_names.length
  ) {
    walletResolveInfo = await exports.resolveWalletIdsFuzzy(
      userId,
      wallet_names
    );
    walletIdsFinal = walletResolveInfo.resolved.map((x) => x.walletId);
  }

  // 2) date range
  let startDate;
  let endDateExclusive;
  let label;

  if (isIsoDate(start_date) && isIsoDate(end_date)) {
    startDate = start_date;
    // end_date inclusive -> exclusive = +1 day
    endDateExclusive = addDaysIso(end_date, 1);
    label = getRangeLabel(start_date, end_date);
  } else {
    // fallback: theo tháng
    const mo = Number.isFinite(Number(monthOffset)) ? Number(monthOffset) : 0;
    const r = getMonthRange(mo);
    startDate = r.startDate;
    endDateExclusive = r.endDate;
    label = r.label || `tháng ${r.month}/${r.year}`;
  }

  // 3) resolve categories fuzzy -> root ids
  const catResolveInfo = await exports.resolveCategoryIdsFuzzy(
    userId,
    category_names
  );
  const rootIds = catResolveInfo.resolved.map((x) => x.categoryId);

  // 4) query
  const rows = await spendingByRootCategoryIdsInRange({
    userId,
    rootCategoryIds: rootIds,
    startDate,
    endDateExclusive,
    walletIds: walletIdsFinal.length ? walletIdsFinal : null,
    includeSubcategories: include_subcategories !== false,
  });

  const items = rows.map((r) => ({
    category_id: Number(r.root_id),
    category_name: r.root_name,
    total_expense: Number(r.total_expense || 0),
  }));

  const total = items.reduce((s, it) => s + Number(it.total_expense || 0), 0);

  return {
    label,
    currency,
    include_subcategories: include_subcategories !== false,
    wallets: {
      wallet_ids: walletIdsFinal,
      resolved: walletResolveInfo.resolved,
      unresolved: walletResolveInfo.unresolved,
    },
    categories: {
      resolved: catResolveInfo.resolved,
      unresolved: catResolveInfo.unresolved,
    },
    items,
    total,
    start_date: startDate,
    end_date_exclusive: endDateExclusive,
  };
};
