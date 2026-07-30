/**
 * Resolve Twilio config: company settings first, then process.env per field.
 */
const CompanySettings = require('../models/CompanySettings');
const { decrypt } = require('./encrypt');

const ENV_HINT =
  'Configure Twilio in Company Settings (manager dashboard) or set TWILIO_* in your server environment, then redeploy.';

function env(name) {
  const v = process.env[name];
  if (v == null || v === undefined) return '';
  return String(v).trim();
}

function getEnvTwilioConfig() {
  const to = env('TWILIO_NOTIFY_PHONE');
  return {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    fromNumber: env('TWILIO_PHONE_NUMBER'),
    toNumber: to,
    toNumbers: to ? [{ name: '', phone: to }] : [],
  };
}

function trimField(v) {
  const s = v == null ? '' : String(v).trim();
  return s.length ? s : '';
}

/**
 * Punch-notification recipients, newest shape first: the recipients list, then the
 * legacy single number, then env. Duplicate phones are dropped.
 * @returns {Array<{ name: string, phone: string }>}
 */
function resolveNotifyRecipients(settings, envCfg) {
  const rows = Array.isArray(settings?.twilioNotifyRecipients) ? settings.twilioNotifyRecipients : [];
  const cleaned = [];
  const seen = new Set();
  for (const row of rows) {
    const phone = trimField(row?.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    cleaned.push({ name: trimField(row?.name), phone });
  }
  if (cleaned.length) return cleaned;

  const legacy = trimField(settings?.twilioNotifyPhone);
  if (legacy) return [{ name: '', phone: legacy }];
  return envCfg.toNumbers;
}

/**
 * @param {string} [companyId]
 * @returns {Promise<{ accountSid: string, authToken: string, fromNumber: string, toNumber: string, toNumbers: Array<{ name: string, phone: string }> }>}
 */
async function getTwilioConfig(companyId) {
  const envCfg = getEnvTwilioConfig();
  const cid = trimField(companyId);
  if (!cid) return envCfg;

  const settings = await CompanySettings.findOne({ companyId: cid })
    .select('twilioAccountSid twilioAuthTokenEncrypted twilioPhoneNumber twilioNotifyPhone twilioNotifyRecipients')
    .lean();
  if (!settings) return envCfg;

  let authToken = '';
  if (settings.twilioAuthTokenEncrypted) {
    try {
      authToken = decrypt(settings.twilioAuthTokenEncrypted) || '';
    } catch (_) {
      authToken = '';
    }
  }

  const toNumbers = resolveNotifyRecipients(settings, envCfg);
  return {
    accountSid: trimField(settings.twilioAccountSid) || envCfg.accountSid,
    authToken: authToken || envCfg.authToken,
    fromNumber: trimField(settings.twilioPhoneNumber) || envCfg.fromNumber,
    toNumber: toNumbers.length ? toNumbers[0].phone : '',
    toNumbers,
  };
}

function missingTwilioCoreVars(cfg) {
  const missing = [];
  if (!cfg.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!cfg.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!cfg.fromNumber) missing.push('TWILIO_PHONE_NUMBER');
  return missing;
}

function missingPunchNotifyVars(cfg) {
  const missing = missingTwilioCoreVars(cfg);
  const recipients = Array.isArray(cfg.toNumbers) ? cfg.toNumbers : [];
  if (!recipients.length && !cfg.toNumber) missing.push('TWILIO_NOTIFY_PHONE');
  return missing;
}

function formatConfigError(missing) {
  return `SMS is not configured. Missing: ${missing.join(', ')}. ${ENV_HINT}`;
}

module.exports = {
  ENV_HINT,
  getEnvTwilioConfig,
  getTwilioConfig,
  missingTwilioCoreVars,
  missingPunchNotifyVars,
  formatConfigError,
};
