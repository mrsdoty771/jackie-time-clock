/**
 * Send SMS via Twilio. Used for punch notifications (clock in/out, lunch in/out)
 * and employee login invite texts.
 *
 * Config precedence (per field): Company Settings → process.env (TWILIO_*).
 */

const twilio = require('twilio');
const {
  ENV_HINT,
  getEnvTwilioConfig,
  getTwilioConfig,
  missingTwilioCoreVars,
  missingPunchNotifyVars,
  formatConfigError,
} = require('./twilioConfig');

function isConfiguredSync() {
  const cfg = getEnvTwilioConfig();
  return missingPunchNotifyVars(cfg).length === 0;
}

function isTwilioCoreConfiguredSync() {
  return missingTwilioCoreVars(getEnvTwilioConfig()).length === 0;
}

const PUNCH_LABELS = {
  clock_in: 'clocked in',
  clock_out: 'clocked out',
  'clock-out': 'clocked out',
  // App: "Go to Lunch" saves lunch_out; "Return from Lunch" saves lunch_in.
  lunch_out: 'started lunch',
  lunch_in: 'ended lunch',
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
 * Log Twilio configuration status once at server startup (env only; per-company in Company Settings).
 */
function logTwilioConfigOnStartup() {
  const cfg = getEnvTwilioConfig();
  const coreMissing = missingTwilioCoreVars(cfg);
  const punchMissing = missingPunchNotifyVars(cfg);

  if (coreMissing.length === 0) {
    console.log(
      '[Twilio] Core SMS configured via environment (from',
      cfg.fromNumber,
      '). Login texts enabled.'
    );
    if (punchMissing.length === 0) {
      console.log('[Twilio] Punch notifications enabled (notify', cfg.toNumber, ').');
    } else {
      console.warn(
        '[Twilio] Punch notifications disabled (env) — missing:',
        punchMissing.join(', '),
        '.',
        ENV_HINT
      );
    }
    console.log('[Twilio] Per-company Twilio can also be set in Company Settings (manager dashboard).');
    return;
  }

  console.warn(
    '[Twilio] No env TWILIO_* core config — SMS may still work per company via Company Settings.',
    ENV_HINT
  );
}

/**
 * Send an SMS when someone punches (clock in, clock out, lunch in, lunch out).
 * Fire-and-forget: does not throw; logs errors.
 * @param {string} companyId
 */
async function sendPunchNotification(employeeName, punchType, punchTime, companyId) {
  const cfg = await getTwilioConfig(companyId);
  const missing = missingPunchNotifyVars(cfg);
  if (missing.length > 0) {
    console.warn('Twilio SMS skipped:', missing.join(', '), '—', ENV_HINT);
    return;
  }
  const rawType = String(punchType || '').trim();
  const label = PUNCH_LABELS[rawType] || PUNCH_LABELS[rawType.replace(/-/g, '_')] || rawType || 'punched';
  const timeStr = formatTime(punchTime);
  const name = String(employeeName || 'Employee').trim() || 'Employee';
  const body = `${name} ${label} at ${timeStr}.`;

  const client = twilio(cfg.accountSid, cfg.authToken);
  client.messages
    .create({
      body,
      from: cfg.fromNumber,
      to: cfg.toNumber,
    })
    .then(() => {
      console.log('SMS sent to', cfg.toNumber, ':', body);
    })
    .catch((err) => {
      const msg = err.message || err.code || String(err);
      console.error('Twilio SMS error:', msg);
      if (msg.toLowerCase().includes('authenticate') || err.code === 20003) {
        console.error(
          'Twilio auth failed: verify Account SID and Auth Token in Company Settings or TWILIO_* env vars. https://console.twilio.com'
        );
      }
    });
}

/**
 * Normalize a US phone number to E.164 (+1XXXXXXXXXX) for Twilio.
 */
function normalizePhoneToE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone || '').trim().startsWith('+') && digits.length >= 10) {
    return `+${digits}`;
  }
  return null;
}

/**
 * Send SMS to an arbitrary phone number (e.g. employee login invite).
 * @param {string} companyId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendSmsToPhone(toPhone, body, companyId) {
  const cfg = await getTwilioConfig(companyId);
  const missing = missingTwilioCoreVars(cfg);
  if (missing.length > 0) {
    return { ok: false, error: formatConfigError(missing) };
  }
  const to = normalizePhoneToE164(toPhone);
  if (!to) {
    return { ok: false, error: 'Invalid phone number. Enter a 10-digit US number.' };
  }
  const client = twilio(cfg.accountSid, cfg.authToken);
  try {
    await client.messages.create({
      body: String(body || '').trim(),
      from: cfg.fromNumber,
      to,
    });
    console.log('SMS sent to', to);
    return { ok: true };
  } catch (err) {
    const msg = err.message || err.code || String(err);
    console.error('Twilio SMS error:', msg);
    return { ok: false, error: msg };
  }
}

module.exports = {
  sendPunchNotification,
  sendSmsToPhone,
  normalizePhoneToE164,
  isConfigured: isConfiguredSync,
  isTwilioCoreConfigured: isTwilioCoreConfiguredSync,
  logTwilioConfigOnStartup,
  getTwilioConfig,
  formatConfigError,
};
