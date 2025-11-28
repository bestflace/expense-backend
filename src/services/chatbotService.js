// src/services/chatbotService.js
const axios = require("axios");
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
  const raw = latestMessage.trim();
  const textNorm = normalizeText(raw);

  const monthOffset = detectMonthOffset(textNorm);

  const formatCurrency = (n) => Number(n || 0).toLocaleString("vi-VN") + "₫";
  // ========== INTENT: Hôm nay chi bao nhiêu? ==========
  if (
    textNorm.includes("hom nay") &&
    (textNorm.includes("chi bao nhieu") ||
      textNorm.includes("chi tieu") ||
      textNorm.includes("chi phi"))
  ) {
    const amount = await getExpenseToday(userId);

    const today = new Date();
    const dateLabel = today.toLocaleDateString("vi-VN");

    if (!amount || amount === 0) {
      return `Hôm nay (${dateLabel}) bạn chưa có khoản chi tiêu nào được ghi nhận.`;
    }

    return `Hôm nay (${dateLabel}), bạn đã chi khoảng ${formatCurrency(
      amount
    )}.`;
  }
  // ========== INTENT: 7 ngày qua chi bao nhiêu? ==========
  if (
    (textNorm.includes("7 ngay") || textNorm.includes("bay ngay")) &&
    (textNorm.includes("chi bao nhieu") ||
      textNorm.includes("chi tieu") ||
      textNorm.includes("chi phi"))
  ) {
    const amount = await getExpenseLast7Days(userId);

    const now = new Date();
    const end = now.toLocaleDateString("vi-VN");
    const startDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6
    );
    const start = startDate.toLocaleDateString("vi-VN");

    if (!amount || amount === 0) {
      return `Trong 7 ngày gần đây (từ ${start} đến ${end}), bạn chưa có khoản chi tiêu nào được ghi nhận.`;
    }

    return `Trong 7 ngày gần đây (từ ${start} đến ${end}), bạn đã chi khoảng ${formatCurrency(
      amount
    )}.`;
  }
  // ========== INTENT: Tình trạng ngân sách / hạn mức tháng này ==========
  // ========== INTENT: Tình trạng ngân sách / hạn mức tháng này ==========
  if (
    textNorm.includes("thang") &&
    (textNorm.includes("ngan sach") || textNorm.includes("han muc"))
  ) {
    const info = await getCurrentBudgetWithUsage(userId, monthOffset);

    if (!info) {
      return `Bạn chưa thiết lập ngân sách tổng cho tháng hiện tại. Hãy vào màn Ngân sách để tạo hạn mức chi tiêu trước nhé.`;
    }

    const { limitAmount, spentAmount, percentage, label, alertThreshold } =
      info;

    const usedPct = percentage ?? 0;
    const alertPct = alertThreshold || 100;

    // Số tiền tương ứng với ngưỡng cảnh báo (ví dụ 80% của limit)
    const alertAmount = (limitAmount * alertPct) / 100;

    // Còn bao nhiêu nữa mới chạm NGƯỠNG CẢNH BÁO
    const remainToAlert = Math.max(alertAmount - spentAmount, 0);

    // Còn bao nhiêu nữa mới chạm HẠN MỨC TỐI ĐA (100%)
    const remainToLimit = Math.max(limitAmount - spentAmount, 0);

    const pctText = usedPct.toFixed(1).replace(".0", "");

    let msg =
      `Ngân sách chi tiêu ${label} của bạn là ${formatCurrency(
        limitAmount
      )}.\n` +
      `Hiện đã chi khoảng ${formatCurrency(spentAmount)} (~${pctText}%).\n`;

    if (remainToAlert > 0) {
      msg += `Bạn còn khoảng ${formatCurrency(
        remainToAlert
      )} trước khi chạm **ngưỡng cảnh báo ${alertPct}%**.\n`;
    } else {
      msg += `⚠️ Bạn đã **vượt ngưỡng cảnh báo ${alertPct}%**.\n`;
    }

    msg += `Từ giờ tới khi chạm **hạn mức tối đa (100%)**, bạn còn khoảng ${formatCurrency(
      remainToLimit
    )}.`;

    return msg;
  }

  // ========== INTENT 4: Tháng này chi bao nhiêu cho danh mục ... ==========
  if (
    textNorm.includes("chi bao nhieu cho") ||
    textNorm.includes("chi cho danh muc") ||
    (textNorm.includes("thang") && textNorm.includes("chi cho"))
  ) {
    const catNames = extractCategoryNames(raw);
    if (!catNames.length) {
      return `Bạn muốn xem chi tiêu cho danh mục nào? Bạn có thể hỏi kiểu: "Tháng này chi bao nhiêu cho danh mục 'Ăn uống' và 'Đi lại'?"`;
    }

    const catLower = catNames.map((n) => n.toLowerCase());
    const result = await getSpendingByCategoryNames(
      userId,
      catLower,
      monthOffset
    );

    if (!result.items || result.items.length === 0) {
      return `Trong ${
        result.label
      }, không tìm thấy chi tiêu cho các danh mục: ${catNames.join(", ")}.`;
    }

    const lines = result.items.map(
      (it) => `- ${it.category_name}: ${formatCurrency(it.total_expense)}`
    );
    const total = result.items.reduce(
      (sum, it) => sum + Number(it.total_expense || 0),
      0
    );

    return [
      `Trong ${
        result.label
      }, chi tiêu cho các danh mục bạn hỏi là khoảng ${formatCurrency(total)}:`,
      ...lines,
    ].join("\n");
  }
  // ===== INTENT: Top 3 giao dịch thu nhập lớn nhất tháng này =====
  if (
    (textNorm.includes("top 3") ||
      textNorm.includes("top3") ||
      textNorm.includes("top ba")) &&
    (textNorm.includes("giao dich") ||
      textNorm.includes("khoan thu") ||
      textNorm.includes("thu nhap")) &&
    (textNorm.includes("lon nhat") ||
      textNorm.includes("cao nhat") ||
      textNorm.includes("nhieu nhat"))
  ) {
    const { items, label } = await getTopBigIncomes(userId, monthOffset, 3);

    if (!items || items.length === 0) {
      return `Trong ${label}, bạn chưa có giao dịch thu nhập nào.`;
    }

    const lines = items.map((it, idx) => {
      const dateStr = new Date(it.tx_date).toLocaleDateString("vi-VN");
      const desc = it.description || "(không có mô tả)";
      return `${idx + 1}. ${formatCurrency(it.amount)} - ${desc} (${
        it.category_name
      }, ví ${it.wallet_name}, ngày ${dateStr})`;
    });

    return [
      `Top ${items.length} giao dịch thu nhập lớn nhất trong ${label}:`,
      ...lines,
    ].join("\n");
  }

  // ===== INTENT: Top 3 giao dịch chi tiêu lớn nhất tháng X =====
  if (
    (textNorm.includes("top 3") ||
      textNorm.includes("top3") ||
      textNorm.includes("top ba")) &&
    (textNorm.includes("giao dich") ||
      textNorm.includes("chi tieu") ||
      textNorm.includes("chi phi")) &&
    (textNorm.includes("lon nhat") ||
      textNorm.includes("cao nhat") ||
      textNorm.includes("nhieu nhat"))
  ) {
    const { items, label } = await getTopBigExpenses(userId, monthOffset, 3);

    if (!items || items.length === 0) {
      return `Trong ${label} bạn chưa có giao dịch chi tiêu nào.`;
    }

    const lines = items.map((it, idx) => {
      const dateStr = new Date(it.tx_date).toLocaleDateString("vi-VN");
      const desc = it.description ? ` – ${it.description}` : "";
      return `${idx + 1}. ${formatCurrency(it.amount)} - ${
        it.category_name
      } (ví ${it.wallet_name}, ${dateStr})${desc}`;
    });

    return (
      `Top 3 giao dịch chi tiêu lớn nhất trong ${label}:\n` + lines.join("\n")
    );
  }

  // ========== INTENT 1: Tháng này chi bao nhiêu? ==========
  if (
    textNorm.includes("thang") &&
    (textNorm.includes("chi bao nhieu") ||
      textNorm.includes("chi tieu") ||
      textNorm.includes("chi phi"))
  ) {
    const { total_expense, label } = await getMonthlyIncomeExpense(
      userId,
      monthOffset
    );
    if (!total_expense || Number(total_expense) === 0) {
      return `Trong ${label} hiện chưa ghi nhận khoản chi tiêu nào.`;
    }
    return `Trong ${label}, bạn đã chi tổng cộng khoảng ${formatCurrency(
      total_expense
    )}.`;
  }

  // ========== INTENT 2: Tháng này thu nhập bao nhiêu? ==========
  if (textNorm.includes("thang") && textNorm.includes("thu nhap")) {
    const { total_income, label } = await getMonthlyIncomeExpense(
      userId,
      monthOffset
    );
    if (!total_income || Number(total_income) === 0) {
      return `Trong ${label} hiện chưa có khoản thu nhập nào được ghi nhận.`;
    }
    return `Trong ${label}, tổng thu nhập của bạn khoảng ${formatCurrency(
      total_income
    )}.`;
  }

  // ========== INTENT 3: Ví nào khấu trừ / chi nhiều nhất? ==========
  if (
    textNorm.includes("vi nao") &&
    (textNorm.includes("khau tru nhieu nhat") ||
      textNorm.includes("tieu nhieu nhat") ||
      textNorm.includes("chi nhieu nhat"))
  ) {
    const [walletInfo, { total_expense, label }] = await Promise.all([
      getTopSpendingWallet(userId, monthOffset),
      getMonthlyIncomeExpense(userId, monthOffset),
    ]);

    if (!walletInfo) {
      return `Trong ${label}, bạn chưa có giao dịch chi tiêu nào nên chưa xác định được ví chi nhiều nhất.`;
    }

    const walletSpend = Number(walletInfo.total_expense || 0);
    const percent =
      total_expense && total_expense > 0
        ? ((walletSpend / total_expense) * 100).toFixed(1)
        : null;

    let extra = "";
    if (percent !== null) {
      extra = `, chiếm khoảng ${percent}% tổng chi tiêu`;
    }

    return `Trong ${label}, ví "${
      walletInfo.wallet_name
    }" là ví chi nhiều nhất với khoảng ${formatCurrency(
      walletSpend
    )}${extra}. Số dư hiện tại của ví này là ${formatCurrency(
      walletInfo.balance
    )}.`;
  }
  // ========== INTENT: Tổng số dư của một tháng (thu - chi) ==========
  if (
    (textNorm.includes("tong so du") || textNorm.includes("chenh lech")) &&
    textNorm.includes("thang")
  ) {
    const { total_income, total_expense, label } =
      await getMonthlyIncomeExpense(userId, monthOffset);

    const income = Number(total_income || 0);
    const expense = Number(total_expense || 0);
    const net = income - expense;
    const diffAbs = Math.abs(net);

    let extra;
    if (net > 0) {
      extra = `Bạn đang thặng dư khoảng ${formatCurrency(
        diffAbs
      )} (thu nhiều hơn chi).`;
    } else if (net < 0) {
      extra = `Bạn đang chi nhiều hơn thu khoảng ${formatCurrency(diffAbs)}.`;
    } else {
      extra = "Tháng này thu nhập và chi tiêu của bạn đang cân bằng.";
    }

    return (
      `Trong ${label}, tổng thu nhập của bạn là ${formatCurrency(
        income
      )}, tổng chi tiêu là ${formatCurrency(expense)}.\n` +
      `Chênh lệch thu - chi (tổng số dư tháng) là ${formatCurrency(net)}.\n` +
      extra
    );
  }
  // ========== INTENT 5: Tổng số dư hiện tại ==========
  if (
    (!textNorm.includes("thang") && textNorm.includes("tong so du")) ||
    textNorm.includes("tong tai san") ||
    textNorm.includes("tong tien hien co")
  ) {
    const balance = await getTotalBalance(userId);
    return `Hiện tại tổng số dư trên các ví của bạn là khoảng ${formatCurrency(
      balance
    )}.`;
  }
  // ========== INTENT 7: Top danh mục chi tiêu trong tháng ==========
  if (
    (textNorm.includes("top") && textNorm.includes("danh muc")) ||
    (textNorm.includes("danh muc") &&
      (textNorm.includes("chi nhieu nhat") ||
        textNorm.includes("tieu nhieu nhat") ||
        textNorm.includes("ton nhieu nhat")))
  ) {
    const { items, label } = await getTopExpenseCategories(
      userId,
      monthOffset,
      5 // lấy top 5
    );

    if (!items || items.length === 0) {
      return `Trong ${label}, chưa có dữ liệu chi tiêu nào để thống kê theo danh mục.`;
    }

    const total = items.reduce(
      (sum, it) => sum + Number(it.total_expense || 0),
      0
    );

    const lines = items.map((it, idx) => {
      const val = Number(it.total_expense || 0);
      const percent = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
      return `${idx + 1}. ${it.category_name}: ${formatCurrency(
        val
      )} (~${percent}%)`;
    });

    return [`Top danh mục chi tiêu trong ${label}:`, ...lines].join("\n");
  }

  // ========== INTENT 8: Số dư của một ví cụ thể ==========
  if (
    (textNorm.includes("so du") && textNorm.includes("vi")) ||
    textNorm.includes("so du cua vi")
  ) {
    const walletName = extractWalletName(raw);
    if (!walletName) {
      return `Bạn muốn xem số dư của ví nào? Bạn có thể hỏi: "Số dư ví 'Ví tiền mặt' là bao nhiêu?"`;
    }

    const wallet = await getWalletByName(userId, walletName);
    if (!wallet) {
      return `Mình không tìm thấy ví nào khớp với tên "${walletName}". Bạn kiểm tra lại tên ví trong màn quản lý ví nhé.`;
    }

    return `Số dư hiện tại của ví "${
      wallet.wallet_name
    }" là khoảng ${formatCurrency(wallet.balance)}.`;
  }
  // ========== INTENT 9: Top giao dịch chi tiêu lớn nhất trong tháng ==========
  if (
    (textNorm.includes("giao dich") && textNorm.includes("lon nhat")) ||
    (textNorm.includes("khoan chi") && textNorm.includes("lon nhat")) ||
    (textNorm.includes("top") &&
      (textNorm.includes("giao dich") || textNorm.includes("chi tieu")))
  ) {
    const { items, label } = await getTopBigExpenses(userId, monthOffset, 3);

    if (!items || items.length === 0) {
      return `Trong ${label}, bạn chưa có giao dịch chi tiêu nào.`;
    }

    const lines = items.map((it, idx) => {
      const dateStr = new Date(it.tx_date).toLocaleDateString("vi-VN");
      const desc = it.description || "(không có mô tả)";
      return `${idx + 1}. ${formatCurrency(it.amount)} - ${desc} (${
        it.category_name
      }, ví ${it.wallet_name}, ngày ${dateStr})`;
    });

    return [
      `Top ${items.length} giao dịch chi tiêu lớn nhất trong ${label}:`,
      ...lines,
    ].join("\n");
  }

  // ========== INTENT 6 (optional): tổng quan tháng ==========
  if (textNorm.includes("tong quan") && textNorm.includes("thang")) {
    const { total_income, total_expense, label } =
      await getMonthlyIncomeExpense(userId, monthOffset);
    const net = Number(total_income || 0) - Number(total_expense || 0);

    return (
      `Tổng quan ${label}:\n` +
      `- Thu nhập: ${formatCurrency(total_income)}\n` +
      `- Chi tiêu: ${formatCurrency(total_expense)}\n` +
      `- Chênh lệch: ${net >= 0 ? "+" : ""}${formatCurrency(net)}`
    );
  }

  // ========== Fallback: không khớp intent nào -> hỏi LLaMA local ==========
  const messages = [
    {
      role: "system",
      content:
        "Bạn là trợ lý tài chính cá nhân cho app BudgetF, nói tiếng Việt, trả lời ngắn gọn, dễ hiểu. Không được cam kết lợi nhuận hay lời khuyên đầu tư rủi ro.",
    },
    ...history.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: latestMessage },
  ];

  try {
    const response = await axios.post("http://localhost:11434/api/chat", {
      model: "llama3.1",
      messages,
      stream: false,
    });

    const reply =
      response.data?.message?.content ||
      response.data?.message ||
      "Xin lỗi, hiện mình không trả lời được câu này.";

    return reply;
  } catch (err) {
    console.error("LLM error:", err.message);
    return "Xin lỗi, hệ thống trợ lý đang gặp lỗi. Bạn thử lại sau nhé.";
  }
};
