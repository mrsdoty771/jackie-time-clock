const crypto = require('crypto');
const LoginInvite = require('../models/LoginInvite');
const CompanySettings = require('../models/CompanySettings');

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

const PUBLIC_URL_ENV_KEYS = ['BASE_URL', 'APP_URL', 'PUBLIC_URL', 'WEB_URL', 'SITE_URL'];

const BASE_URL_ENV_HINT =
  'Set Public app URL in Company Settings or BASE_URL in your hosting environment (e.g. https://your-app.ondigitalocean.app), then redeploy. Local dev: optional in .env when NODE_ENV is not production.';

function trimUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function getPublicBaseUrlFromEnv() {
  for (const key of PUBLIC_URL_ENV_KEYS) {
    const trimmed = trimUrl(process.env[key]);
    if (trimmed) return trimmed;
  }

  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    return `http://127.0.0.1:${port}`;
  }

  return '';
}

/**
 * Public base URL for login invite links. Company Settings publicBaseUrl first, then env.
 * @param {string} [companyId]
 * @returns {Promise<string>}
 */
async function getPublicBaseUrl(companyId) {
  const cid = String(companyId || '').trim();
  if (cid) {
    const settings = await CompanySettings.findOne({ companyId: cid }).select('publicBaseUrl').lean();
    const fromCompany = trimUrl(settings?.publicBaseUrl);
    if (fromCompany) return fromCompany;
  }
  return getPublicBaseUrlFromEnv();
}

/**
 * Log public base URL status at server startup (env only).
 */
function logPublicBaseUrlOnStartup() {
  const base = getPublicBaseUrlFromEnv();
  if (base) {
    console.log('[BASE_URL] Login invite links will use (env):', base);
    console.log('[BASE_URL] Per-company Public app URL can override in Company Settings.');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[BASE_URL] Not set in env — login invite SMS needs Company Settings Public app URL or BASE_URL.',
      BASE_URL_ENV_HINT
    );
    return;
  }
  console.log('[BASE_URL] Using local default for login invites:', getPublicBaseUrlFromEnv());
}

/**
 * Create a one-time login invite token for an employee user.
 * @returns {Promise<{ token: string, loginUrl: string, expiresAt: Date }>}
 */
async function createLoginInvite(companyId, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await LoginInvite.create({
    companyId: String(companyId).trim(),
    token,
    userId,
    expiresAt,
  });
  const base = await getPublicBaseUrl(companyId);
  const loginUrl = base ? `${base}/?invite=${encodeURIComponent(token)}` : `/?invite=${encodeURIComponent(token)}`;
  return { token, loginUrl, expiresAt };
}

/**
 * Redeem invite once; returns credentials for pre-filled login.
 * @returns {Promise<{ companyId: string, username: string, password: string }|null>}
 */
async function redeemLoginInvite(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token) return null;

  const invite = await LoginInvite.findOne({ token }).lean();
  if (!invite || invite.usedAt) return null;
  if (new Date(invite.expiresAt).getTime() < Date.now()) return null;

  const marked = await LoginInvite.findOneAndUpdate(
    { token, usedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true }
  ).lean();
  if (!marked) return null;

  return { companyId: invite.companyId, userId: invite.userId };
}

module.exports = {
  createLoginInvite,
  redeemLoginInvite,
  getPublicBaseUrl,
  getPublicBaseUrlFromEnv,
  logPublicBaseUrlOnStartup,
  INVITE_TTL_MS,
  BASE_URL_ENV_HINT,
};
