const nodemailer = require('nodemailer');

/**
 * System-wide SMTP (from .env). Used for employee onboarding and similar.
 * Mirrors the fallback branch in authController.testEmail.
 */
function getSystemMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = port === 465;
  return {
    transporter: nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    }),
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  };
}

async function sendSystemEmail({ to, subject, text }) {
  const cfg = getSystemMailer();
  if (!cfg) {
    return { sent: false, error: 'SMTP_USER and SMTP_PASS are not set in the environment.' };
  }
  await cfg.transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
  });
  return { sent: true };
}

module.exports = { getSystemMailer, sendSystemEmail };
