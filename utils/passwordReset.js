const crypto = require('crypto');
const PasswordReset = require('../models/PasswordReset');
const { getPublicBaseUrl } = require('./loginInvite');

const RESET_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a one-time password-reset link for a user. Invalidates prior unused tokens for that user.
 * @returns {Promise<{ token: string, resetUrl: string, expiresAt: Date }>}
 */
async function createPasswordReset(companyId, userId) {
  const cid = String(companyId).trim();
  await PasswordReset.updateMany(
    { companyId: cid, userId, usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await PasswordReset.create({
    companyId: cid,
    token,
    userId,
    expiresAt,
  });

  const base = await getPublicBaseUrl(companyId);
  const resetUrl = base
    ? `${base}/?reset=${encodeURIComponent(token)}`
    : `/?reset=${encodeURIComponent(token)}`;
  return { token, resetUrl, expiresAt };
}

/**
 * Look up a valid unused reset token (does not consume it).
 * @returns {Promise<{ companyId: string, userId: * }|null>}
 */
async function peekPasswordReset(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token) return null;

  const row = await PasswordReset.findOne({ token, usedAt: null }).lean();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  return { companyId: row.companyId, userId: row.userId };
}

/**
 * Mark a reset token used (one-time). Returns null if invalid/expired/already used.
 * @returns {Promise<{ companyId: string, userId: * }|null>}
 */
async function consumePasswordReset(tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token) return null;

  const now = new Date();
  const marked = await PasswordReset.findOneAndUpdate(
    { token, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true }
  ).lean();
  if (!marked) return null;
  return { companyId: marked.companyId, userId: marked.userId };
}

module.exports = {
  createPasswordReset,
  peekPasswordReset,
  consumePasswordReset,
  RESET_TTL_MS,
};
