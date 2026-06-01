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
  return {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    fromNumber: env('TWILIO_PHONE_NUMBER'),
    toNumber: env('TWILIO_NOTIFY_PHONE'),
  };
}

function trimField(v) {
  const s = v == null ? '' : String(v).trim();
  return s.length ? s : '';
}

/**
 * @param {string} [companyId]
 * @returns {Promise<{ accountSid: string, authToken: string, fromNumber: string, toNumber: string }>}
 */
async function getTwilioConfig(companyId) {
  const envCfg = getEnvTwilioConfig();
  const cid = trimField(companyId);
  if (!cid) return envCfg;

  const settings = await CompanySettings.findOne({ companyId: cid })
    .select('twilioAccountSid twilioAuthTokenEncrypted twilioPhoneNumber twilioNotifyPhone')
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

  return {
    accountSid: trimField(settings.twilioAccountSid) || envCfg.accountSid,
    authToken: authToken || envCfg.authToken,
    fromNumber: trimField(settings.twilioPhoneNumber) || envCfg.fromNumber,
    toNumber: trimField(settings.twilioNotifyPhone) || envCfg.toNumber,
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
  if (!cfg.toNumber) missing.push('TWILIO_NOTIFY_PHONE');
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
