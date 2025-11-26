// src/services/emailService.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // ví dụ: "smtp.gmail.com"
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // true nếu dùng 465
  auth: {
    user: process.env.SMTP_USER, // email gửi
    pass: process.env.SMTP_PASS, // app password
  },
});

async function sendBudgetAlertEmail({ to, subject, html, text }) {
  if (!to) {
    console.warn("sendBudgetAlertEmail: thiếu địa chỉ người nhận");
    return;
  }

  await transporter.sendMail({
    from: `"BudgetF" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}
async function sendPasswordResetEmail({ to, code }) {
  if (!to) {
    console.warn("sendPasswordResetEmail: thiếu địa chỉ người nhận");
    return;
  }

  const subject = "Mã xác nhận đặt lại mật khẩu";
  const text = `Mã xác nhận đặt lại mật khẩu của bạn là: ${code}. Mã có hiệu lực trong 15 phút.`;
  const html = `
    <p>Xin chào,</p>
    <p>Mã xác nhận đặt lại mật khẩu của bạn là:</p>
    <h2>${code}</h2>
    <p>Mã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
  `;

  await transporter.sendMail({
    from: `"BudgetF" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  sendBudgetAlertEmail,
  sendPasswordResetEmail,
};
