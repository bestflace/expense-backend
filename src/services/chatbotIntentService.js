// src/services/chatbotIntentService.js

// tiện: normalize tiếng Việt đơn giản (bỏ hoa, khoảng trắng thừa)
function normalize(text) {
  return text.toLowerCase().trim();
}

// tạm map 1 số danh mục hay dùng
const CATEGORY_KEYWORDS = [
  "ăn uống",
  "giải trí",
  "đi lại",
  "mua sắm",
  "hoá đơn",
];

function detectMonthInfo(text) {
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();

  if (text.includes("tháng này") || text.includes("tháng hiện tại")) {
    // giữ nguyên month/year hiện tại
  } else if (text.includes("tháng trước")) {
    const d = new Date(year, month - 2, 1); // tháng trước
    month = d.getMonth() + 1;
    year = d.getFullYear();
  } else {
    // bắt pattern "tháng 11", "tháng 3", ...
    const m = text.match(/tháng\s+(\d{1,2})/);
    if (m) {
      month = parseInt(m[1], 10);
      // nếu người dùng không nói năm thì giả định năm hiện tại
    }
  }

  return { month, year };
}

function detectCategory(text) {
  for (const c of CATEGORY_KEYWORDS) {
    if (text.includes(c)) return c;
  }
  return null;
}

function detectCreateWallet(text) {
  // ví dụ câu: "Tạo cho tôi một ví với thông tin là Ví Du Lịch với số tiền 1000000"
  const hasCreate =
    text.includes("tạo ví") ||
    text.includes("mở ví") ||
    text.includes("thêm ví");

  if (!hasCreate) return null;

  // lấy tên ví rất đơn giản: "là ... với số tiền"
  let name = "Ví mới";
  const nameMatch = text.match(/là\s+(.+?)\s+với\s+số\s+tiền/);
  if (nameMatch) {
    name = nameMatch[1].trim();
  }

  // lấy số tiền
  let amount = 0;
  const moneyMatch = text.match(/số\s+tiền\s+([\d\.]+)/);
  if (moneyMatch) {
    amount = parseInt(moneyMatch[1].replace(/\./g, ""), 10);
  }

  return { walletName: name, initialBalance: amount };
}

exports.detectIntent = function detectIntent(rawMessage) {
  const text = normalize(rawMessage);

  // 1) Tạo ví
  const createWallet = detectCreateWallet(text);
  if (createWallet) {
    return {
      type: "CREATE_WALLET",
      data: createWallet,
    };
  }

  // 2) Hỏi chi tiêu theo danh mục / tháng
  if (
    text.includes("chi bao nhiêu") ||
    text.includes("chi tiêu") ||
    text.includes("đã xài") ||
    text.includes("đã tiêu")
  ) {
    const { month, year } = detectMonthInfo(text);
    const categoryName = detectCategory(text); // có thể null

    return {
      type: "SPENDING_SUMMARY",
      data: { month, year, categoryName },
    };
  }

  // 3) Hỏi thu nhập
  if (text.includes("thu nhập") || text.includes("kiếm được")) {
    const { month, year } = detectMonthInfo(text);
    return {
      type: "INCOME_SUMMARY",
      data: { month, year },
    };
  }

  // 4) Mặc định: small talk
  return {
    type: "SMALL_TALK",
    data: {},
  };
};
