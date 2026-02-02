const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32;
const SALT = 'smtp-pass-v1';

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'fallback-secret';
  return crypto.scryptSync(secret, SALT, KEY_LEN);
}

function encrypt(plain) {
  if (!plain) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

function decrypt(encrypted) {
  if (!encrypted) return null;
  try {
    const key = getKey();
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const data = buf.subarray(IV_LEN + AUTH_TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(data) + decipher.final('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
