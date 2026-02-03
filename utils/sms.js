/**
 * Send SMS via Twilio. Used for punch notifications (clock in/out, lunch in/out).
 * Requires in .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWILIO_NOTIFY_PHONE
 */

const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim?.() || process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim?.() || process.env.TWILIO_AUTH_TOKEN || '';
const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim?.() || process.env.TWILIO_PHONE_NUMBER || '';
const toNumber = process.env.TWILIO_NOTIFY_PHONE?.trim?.() || process.env.TWILIO_NOTIFY_PHONE || '';

function isConfigured() {
  return (
    accountSid &&
    authToken &&
    fromNumber &&
    toNumber &&
    String(fromNumber).trim() !== '' &&
    String(toNumber).trim() !== ''
  );
}

const PUNCH_LABELS = {
  clock_in: 'clocked in',
  clock_out: 'clocked out',
  'clock-out': 'clocked out',
  lunch_in: 'started lunch',
  lunch_out: 'ended lunch',
};

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Send an SMS when someone punches (clock in, clock out, lunch in, lunch out).
 * Fire-and-forget: does not throw; logs errors.
 * @param {string} employeeName - Display name of the employee
 * @param {string} punchType - One of: clock_in, clock_out, lunch_in, lunch_out
 * @param {Date|string} punchTime - Time of the punch
 */
function sendPunchNotification(employeeName, punchType, punchTime) {
  if (!isConfigured()) {
    const missing = [];
    if (!accountSid || !String(accountSid).trim()) missing.push('TWILIO_ACCOUNT_SID');
    if (!authToken || !String(authToken).trim()) missing.push('TWILIO_AUTH_TOKEN');
    if (!fromNumber || !String(fromNumber).trim()) missing.push('TWILIO_PHONE_NUMBER');
    if (!toNumber || !String(toNumber).trim()) missing.push('TWILIO_NOTIFY_PHONE');
    console.warn('Twilio SMS skipped: add to .env and restart server:', missing.join(', ') || 'check variable names');
    return;
  }
  const rawType = String(punchType || '').trim();
  const label = PUNCH_LABELS[rawType] || PUNCH_LABELS[rawType.replace(/-/g, '_')] || rawType || 'punched';
  const timeStr = formatTime(punchTime);
  const name = String(employeeName || 'Employee').trim() || 'Employee';
  const body = `${name} ${label} at ${timeStr}.`;

  const sid = String(accountSid).trim();
  const token = String(authToken).trim();
  const client = twilio(sid, token);
  client.messages
    .create({
      body,
      from: String(fromNumber).trim(),
      to: String(toNumber).trim(),
    })
    .then(() => {
      console.log('SMS sent to', String(toNumber).trim(), ':', body);
    })
    .catch((err) => {
      const msg = err.message || err.code || String(err);
      console.error('Twilio SMS error:', msg);
      if (msg.toLowerCase().includes('authenticate') || err.code === 20003) {
        console.error('Twilio auth failed: check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env (no spaces). Get current values from https://console.twilio.com');
      }
    });
}

module.exports = { sendPunchNotification, isConfigured };
