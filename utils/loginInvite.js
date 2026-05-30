const crypto = require('crypto');
const LoginInvite = require('../models/LoginInvite');

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function getPublicBaseUrl() {
  const raw = process.env.BASE_URL || process.env.APP_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
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
  const base = getPublicBaseUrl();
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

module.exports = { createLoginInvite, redeemLoginInvite, getPublicBaseUrl, INVITE_TTL_MS };
