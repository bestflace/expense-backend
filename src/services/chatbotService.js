// src/services/chatbotService.js
const {
  getMonthlyIncomeExpense,
  getTopSpendingWallet,
  getSpendingByCategoryNames,
  getTotalBalance,
  getTopExpenseCategories,
  getWalletByName,
  getTopBigExpenses,
  getTopBigIncomes,
  getExpenseToday,
  getExpenseLast7Days,
  getCurrentBudgetWithUsage,
} = require("./chatbotDataService");
const formatCurrency = (n) => Number(n || 0).toLocaleString("vi-VN") + "₫";
const { runGeminiWithTools } = require("./geminiAssistantService");
// bỏ dấu tiếng Việt để dễ match
function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// monthOffset: 0 = tháng hiện tại, âm = các tháng quá khứ, dương = tương lai
// monthOffset: 0 = tháng này, -1 = tháng trước, ... (tính theo số tháng lệch)
function detectMonthOffset(textNorm) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1..12
  const currentYear = now.getFullYear();

  // "tháng này"
  if (textNorm.includes("thang nay")) {
    return 0;
  }

  // "tháng trước"
  if (textNorm.includes("thang truoc")) {
    return -1;
  }

  // Nếu có ghi rõ "thang 11", "thang 9", ...
  let targetMonth = currentMonth;
  let targetYear = currentYear;
  let hasExplicitMonth = false;

  const mMatch = textNorm.match(/thang\s+(\d{1,2})/);
  if (mMatch) {
    const mNum = parseInt(mMatch[1], 10);
    if (mNum >= 1 && mNum <= 12) {
      targetMonth = mNum;
      hasExplicitMonth = true;
    }
  }

  // "nam 2024"
  const yMatch = textNorm.match(/nam\s+(\d{4})/);
  if (yMatch) {
    const yNum = parseInt(yMatch[1], 10);
    if (yNum > 1900 && yNum < 3000) {
      targetYear = yNum;
    }
  }

  // Nếu không chỉ rõ tháng/năm thì coi như tháng này
  if (!hasExplicitMonth && !yMatch) {
    return 0;
  }

  // Tính số tháng lệch
  const diffYear = targetYear - currentYear;
  const diffMonth = targetMonth - currentMonth;
  return diffYear * 12 + diffMonth;
}

/**
 * Tách tên danh mục từ câu hỏi:
 * - Ưu tiên text trong dấu nháy: "ăn uống", 'Đi lại'
 * - Nếu không có, lấy phần sau chữ "cho ..."
 */
function extractCategoryNames(rawMessage) {
  const names = [];

  // 1) lấy những phần trong dấu nháy
  const quoted = [...rawMessage.matchAll(/["“'‘](.+?)["”'’]/g)];
  for (const m of quoted) {
    const name = m[1].trim();
    if (name) names.push(name);
  }
  if (names.length > 0) return names;

  // 2) fallback: lấy phần sau chữ "cho "
  const lowerRaw = rawMessage.toLowerCase();
  const choMatch = lowerRaw.match(/cho\s+(.+)/);
  if (!choMatch) return [];

  let segment = choMatch[1];

  // cắt bớt mấy từ cuối hay gặp
  segment = segment.replace(/thang nay|thang truoc|bao nhieu|\?/gi, "");

  // bỏ "danh muc"/"danh mục" ở đầu nếu có
  segment = segment.replace(/^danh muc\s+|^danh mục\s+/i, "");

  segment
    .split(/,| và | va /i)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((n) => names.push(n));

  return names;
}
function extractWalletName(rawMessage) {
  // ưu tiên chuỗi trong dấu nháy
  const quoted = rawMessage.match(/["“'‘](.+?)["”'’]/);
  if (quoted) {
    return quoted[1].trim();
  }

  // fallback: lấy phần sau chữ "ví"/"vi"
  const lower = rawMessage.toLowerCase();
  const m = lower.match(/vi\s+(.+)/); // bắt sau chữ "vi ..."
  if (!m) return null;

  let name = m[1].trim();
  // bỏ dấu hỏi, chấm ở cuối
  name = name.replace(/[?.!]+$/, "");
  return name;
}

/**
 * Hàm chính: dùng cho controller
 */
exports.callAssistant = async ({ userId, history, latestMessage }) => {
  try {
    return await runGeminiWithTools({ userId, history, latestMessage });
  } catch (err) {
    console.error("Gemini error:", err?.message || err);
    return "Xin lỗi, hệ thống trợ lý đang gặp lỗi. Bạn thử lại sau nhé.";
  }
};
