// src/services/geminiAssistantService.js
// Gemini Function Calling (Google AI Studio) - CommonJS friendly via dynamic import

const data = require("./chatbotDataService");

let _ai = null;
let _Type = null;

async function getGeminiClient() {
  if (_ai && _Type) return { ai: _ai, Type: _Type };

  const mod = await import("@google/genai");
  const { GoogleGenAI, Type } = mod;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in environment");

  _ai = new GoogleGenAI({ apiKey });
  _Type = Type;
  return { ai: _ai, Type };
}

function getCurrentMonthYearVN() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { year: Number(get("year")), month: Number(get("month")) };
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.trunc(x);
  return Math.max(min, Math.min(max, xi));
}

function resolveMonthOffset(args = {}) {
  // monthOffset ưu tiên nhất
  if (args.monthOffset !== undefined && args.monthOffset !== null) {
    return clampInt(args.monthOffset, -240, 240, 0);
  }

  // month + year
  const month = args.month !== undefined ? Number(args.month) : null;
  const year = args.year !== undefined ? Number(args.year) : null;

  if (
    Number.isFinite(month) &&
    Number.isFinite(year) &&
    month >= 1 &&
    month <= 12 &&
    year >= 1900 &&
    year <= 3000
  ) {
    const now = getCurrentMonthYearVN();
    return (year - now.year) * 12 + (month - now.month);
  }

  // default: tháng này
  return 0;
}

function historyToGeminiContents(history, latestMessage) {
  const contents = (history || []).map((m) => ({
    role: m.sender === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // tránh double latestMessage
  const last = contents[contents.length - 1];
  if (
    !last ||
    last.role !== "user" ||
    last.parts?.[0]?.text !== latestMessage
  ) {
    contents.push({ role: "user", parts: [{ text: latestMessage }] });
  }
  return contents;
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: true, message: e?.message || "Tool error" };
  }
}
function parseRetryAfterSeconds(err) {
  const msg = err?.message || "";
  // SDK thường nhét JSON trong message
  try {
    const obj = JSON.parse(msg);
    const retryInfo = obj?.error?.details?.find((d) =>
      d["@type"]?.includes("RetryInfo")
    );
    const delay = retryInfo?.retryDelay; // "53s"
    if (typeof delay === "string" && delay.endsWith("s")) {
      const sec = Number(delay.slice(0, -1));
      if (Number.isFinite(sec)) return sec;
    }
  } catch (_) {}

  // fallback: parse "Please retry in XXs"
  const m = msg.match(/retry in\s+([\d.]+)s/i);
  if (m) return Math.ceil(Number(m[1]));
  return null;
}

function isQuota429(err) {
  const msg = err?.message || "";
  return (
    msg.includes('"code":429') ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("Quota exceeded")
  );
}

async function runGeminiWithTools({ userId, history, latestMessage }) {
  const { ai, Type } = await getGeminiClient();

  // ===== Tool handlers (server-side truth) =====
  const toolFunctions = {
    get_monthly_income_expense: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      return data.getMonthlyIncomeExpense(userId, monthOffset);
    },

    get_budget_status_total_month: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      const info = await data.getCurrentBudgetWithUsage(userId, monthOffset);
      if (!info) return { exists: false };
      return { exists: true, ...info };
    },

    get_total_balance: async () => {
      const total = await data.getTotalBalance(userId);
      return { total_balance: total };
    },

    get_wallet_balance_by_name: async (args) => {
      const walletName = String(args?.walletName || "").trim();
      if (!walletName) {
        return {
          need_wallet_name: true,
          message:
            "Bạn muốn xem số dư của ví nào? (Ví dụ: Tiền mặt, MoMo, Ngân hàng...)",
        };
      }

      const w = await data.getWalletByName(userId, walletName);
      if (!w) return { found: false, walletName };
      return { found: true, ...w };
    },

    get_top_expense_categories: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      const limit = clampInt(args?.limit, 1, 20, 5);
      return data.getTopExpenseCategories(userId, monthOffset, limit);
    },

    get_expense_in_range: async (args) => {
      const startDate = String(args?.start_date || "").trim();
      const endDateExclusive = String(args?.end_date_exclusive || "").trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw new Error("start_date must be YYYY-MM-DD");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateExclusive)) {
        throw new Error("end_date_exclusive must be YYYY-MM-DD");
      }
      // NOTE: chatbotDataService.getExpenseInRange dùng [start, end) :contentReference[oaicite:1]{index=1}
      return data.getExpenseInRange(userId, startDate, endDateExclusive);
    },

    // ✅ Tool “xịn” (fuzzy + range + wallets + include sub) gọi thẳng data.getSpendingByCategories
    get_spending_by_categories: async (args) => {
      // chatbotDataService đã có hàm này :contentReference[oaicite:2]{index=2}
      if (typeof data.getSpendingByCategories !== "function") {
        throw new Error(
          "chatbotDataService.getSpendingByCategories is missing"
        );
      }
      return data.getSpendingByCategories({ userId, ...args });
    },
    get_top_big_expenses: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      const limit = clampInt(args?.limit, 1, 20, 3);
      return data.getTopBigExpenses(userId, monthOffset, limit);
    },

    get_top_big_incomes: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      const limit = clampInt(args?.limit, 1, 20, 3);
      return data.getTopBigIncomes(userId, monthOffset, limit);
    },
    get_top_spending_wallet: async (args) => {
      const monthOffset = resolveMonthOffset(args);
      const top = await data.getTopSpendingWallet(userId, monthOffset);
      if (!top) return { found: false };
      return { found: true, ...top };
    },
  };

  // ===== Tool declarations (what Gemini can call) =====
  const tools = [
    {
      functionDeclarations: [
        {
          name: "get_monthly_income_expense",
          description:
            "Lấy tổng thu nhập và tổng chi tiêu trong 1 tháng. Có thể truyền monthOffset hoặc month+year.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              monthOffset: {
                type: Type.NUMBER,
                description: "0=tháng này, -1=tháng trước...",
              },
              month: {
                type: Type.NUMBER,
                description: "Tháng 1..12 (optional)",
              },
              year: { type: Type.NUMBER, description: "Năm (optional)" },
            },
          },
        },
        {
          name: "get_top_spending_wallet",
          description:
            "Lấy ví chi tiêu nhiều nhất trong tháng (chỉ tính expense). Có thể truyền monthOffset hoặc month+year.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              monthOffset: {
                type: Type.NUMBER,
                description: "0=tháng này, -1=tháng trước...",
              },
              month: {
                type: Type.NUMBER,
                description: "Tháng 1..12 (optional)",
              },
              year: { type: Type.NUMBER, description: "Năm (optional)" },
            },
          },
        },

        {
          name: "get_top_big_expenses",
          description:
            "Lấy top N giao dịch CHI TIÊU lớn nhất trong tháng (theo amount).",
          parameters: {
            type: Type.OBJECT,
            properties: {
              limit: {
                type: Type.NUMBER,
                description: "Số lượng giao dịch (1..20), mặc định 3",
              },
              monthOffset: {
                type: Type.NUMBER,
                description: "0=tháng này, -1=tháng trước...",
              },
              month: {
                type: Type.NUMBER,
                description: "Tháng 1..12 (optional)",
              },
              year: { type: Type.NUMBER, description: "Năm (optional)" },
            },
          },
        },
        {
          name: "get_top_big_incomes",
          description:
            "Lấy top N giao dịch THU NHẬP lớn nhất trong tháng (theo amount).",
          parameters: {
            type: Type.OBJECT,
            properties: {
              limit: {
                type: Type.NUMBER,
                description: "Số lượng giao dịch (1..20), mặc định 3",
              },
              monthOffset: {
                type: Type.NUMBER,
                description: "0=tháng này, -1=tháng trước...",
              },
              month: {
                type: Type.NUMBER,
                description: "Tháng 1..12 (optional)",
              },
              year: { type: Type.NUMBER, description: "Năm (optional)" },
            },
          },
        },
        {
          name: "get_budget_status_total_month",
          description:
            "Kiểm tra ngân sách tổng tháng (category_id NULL & wallet_id NULL) và số tiền đã chi. Có thể truyền monthOffset hoặc month+year.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              monthOffset: { type: Type.NUMBER },
              month: { type: Type.NUMBER },
              year: { type: Type.NUMBER },
            },
          },
        },

        {
          name: "get_spending_by_categories",
          description:
            "Tính chi tiêu theo 1 hoặc nhiều danh mục. Hỗ trợ fuzzy tên danh mục, theo tháng hoặc theo khoảng ngày, lọc theo 1/nhiều ví, và tính cả sub-category.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              category_names: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Tên danh mục (vd: ['an uong','đi lại'])",
              },

              // chọn 1 trong 2 cách: (start_date + end_date) OR monthOffset
              start_date: {
                type: Type.STRING,
                description: "YYYY-MM-DD (inclusive range start)",
              },
              end_date: {
                type: Type.STRING,
                description: "YYYY-MM-DD (inclusive range end)",
              },

              monthOffset: {
                type: Type.NUMBER,
                description: "0=tháng này, -1=tháng trước...",
              },
              month: {
                type: Type.NUMBER,
                description: "Tháng 1..12 (optional)",
              },
              year: { type: Type.NUMBER, description: "Năm (optional)" },

              wallet_names: { type: Type.ARRAY, items: { type: Type.STRING } },
              wallet_ids: { type: Type.ARRAY, items: { type: Type.NUMBER } },

              include_subcategories: {
                type: Type.BOOLEAN,
                description: "default true",
              },
              currency: { type: Type.STRING, description: "default VND" },
            },
            required: ["category_names"],
          },
        },
        {
          name: "get_top_expense_categories",
          description:
            "Lấy top danh mục chi tiêu trong tháng. Có thể truyền monthOffset hoặc month+year.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              monthOffset: { type: Type.NUMBER },
              month: { type: Type.NUMBER },
              year: { type: Type.NUMBER },
              limit: { type: Type.NUMBER, description: "1..20" },
            },
          },
        },
        {
          name: "get_total_balance",
          description:
            "Tổng số dư hiện tại (sum balance các ví chưa archived).",
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: "get_wallet_balance_by_name",
          description: "Lấy số dư của một ví theo tên.",
          parameters: {
            type: Type.OBJECT,
            properties: { walletName: { type: Type.STRING } },
          },
        },
        {
          name: "get_expense_in_range",
          description:
            "Tổng chi tiêu trong khoảng ngày bất kỳ theo dạng [start_date, end_date_exclusive).",
          parameters: {
            type: Type.OBJECT,
            properties: {
              start_date: { type: Type.STRING, description: "YYYY-MM-DD" },
              end_date_exclusive: {
                type: Type.STRING,
                description: "YYYY-MM-DD (exclusive)",
              },
            },
            required: ["start_date", "end_date_exclusive"],
          },
        },
      ],
    },
  ];

  const systemInstruction = `
Bạn là trợ lý tài chính cá nhân cho app quản lý chi tiêu.
Quy tắc bắt buộc:
- Trả lời tiếng Việt, ngắn gọn, rõ ràng.
- Khi câu hỏi cần số liệu (thu/chi/budget/danh mục/ví/thống kê), BẮT BUỘC gọi tool. Không tự bịa số.
- Nếu tool trả về unresolved/không có dữ liệu, nói rõ và hỏi lại 1 câu ngắn.
- Ngân sách: chỉ kiểm tra budget tổng tháng (category_id NULL & wallet_id NULL).
`.trim();

  let contents = historyToGeminiContents(history, latestMessage);
  const maxIterations = 3;

  for (let i = 0; i < maxIterations; i++) {
    let result;
    try {
      result = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents,
        config: {
          tools,
          systemInstruction,
          temperature: 0.2,
        },
      });
    } catch (err) {
      if (isQuota429(err)) {
        const sec = parseRetryAfterSeconds(err) ?? 60;
        return `Bạn đang bị giới hạn lượt gọi AI (quota). Vui lòng thử lại sau khoảng ${sec} giây nhé.`;
      }
      console.error("Gemini error:", err?.message || err);
      return "Xin lỗi, hệ thống trợ lý đang gặp lỗi. Bạn thử lại sau nhé.";
    }

    if (result.functionCalls && result.functionCalls.length > 0) {
      for (const fc of result.functionCalls) {
        const { name, args } = fc;

        const toolFn = toolFunctions[name];
        const toolResult = toolFn
          ? await safeCall(() => toolFn(args || {}))
          : { error: true, message: `Unknown tool: ${name}` };

        contents.push({ role: "model", parts: [{ functionCall: fc }] });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name,
                response: { result: toolResult },
              },
            },
          ],
        });
      }
      continue;
    }

    return result.text || "Xin lỗi, mình chưa xử lý được câu hỏi này.";
  }

  return "Xin lỗi, câu hỏi này cần nhiều bước xử lý hơn. Bạn thử hỏi cụ thể hơn (tháng/năm, danh mục, ví) nhé.";
}

module.exports = { runGeminiWithTools };
