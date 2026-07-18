const User = require('../models/User');

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive username match within a company (optional excludeUserId for edits). */
async function findUserByUsernameCI(companyId, usernameRaw, { excludeUserId = null, lean = true } = {}) {
  const username = String(usernameRaw || '').trim();
  if (!username || !companyId) return null;
  const query = {
    companyId: String(companyId).trim(),
    username: new RegExp(`^${escapeRegex(username)}$`, 'i'),
  };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  const q = User.findOne(query);
  return lean ? q.lean() : q;
}

/** Login style: first name + last name initial, e.g. "Josh Doe" -> "JoshD". One word -> that word capitalized. */
function suggestedLoginUsernameFromDisplayName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const firstSan = parts[0].replace(/[^a-zA-Z0-9]/g, '');
  if (!firstSan) return '';
  const first = firstSan.charAt(0).toUpperCase() + firstSan.slice(1).toLowerCase();
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1];
  const letter = last.match(/[a-zA-Z]/);
  if (!letter) return first;
  return first + letter[0].toUpperCase();
}

/** True when stored username is blank or still the employee number (legacy accounts). */
function usernameLooksLikeEmployeeNumber(username, employeeNumber) {
  const u = String(username ?? '').trim();
  if (!u) return true;
  const e = String(employeeNumber ?? '').trim();
  if (!e) return false;
  if (u === e) return true;
  if (/^\d+$/.test(u) && /^\d+$/.test(e)) {
    const nu = parseInt(u, 10);
    const ne = parseInt(e, 10);
    if (!Number.isNaN(nu) && !Number.isNaN(ne) && nu === ne) return true;
  }
  return false;
}

async function allocateUniqueLoginUsername(companyId, fullName, fallbackBase, excludeUserId = null) {
  let base = suggestedLoginUsernameFromDisplayName(fullName);
  if (!base) {
    base = String(fallbackBase || 'user').replace(/[^a-zA-Z0-9]/g, '');
  }
  if (!base) base = 'user';
  let candidate = base;
  for (let n = 0; n < 500; n += 1) {
    const clash = await findUserByUsernameCI(companyId, candidate, { excludeUserId });
    if (!clash) return candidate;
    candidate = `${base}${n + 1}`;
  }
  return `${base}${Date.now().toString(36)}`;
}

/**
 * Upgrade legacy login usernames that still match the employee number.
 * @returns {Promise<string>} The login username to use (may update the user record).
 */
async function ensureEmployeeLoginUsername(companyId, employee, user, { save = true } = {}) {
  const empNum = String(employee?.employeeNumber || employee?.employee_number || '').trim();
  const stored = String(user?.username || '').trim();
  if (!usernameLooksLikeEmployeeNumber(stored, empNum)) {
    return stored;
  }
  const displayName = String(employee?.name || user?.name || '').trim();
  const newUsername = await allocateUniqueLoginUsername(companyId, displayName, empNum, user._id);
  if (typeof user.save === 'function') {
    user.username = newUsername;
    if (save) await user.save();
  } else {
    if (save) {
      await User.updateOne({ _id: user._id, companyId }, { $set: { username: newUsername } });
    }
    user.username = newUsername;
  }
  return newUsername;
}

module.exports = {
  escapeRegex,
  findUserByUsernameCI,
  suggestedLoginUsernameFromDisplayName,
  usernameLooksLikeEmployeeNumber,
  allocateUniqueLoginUsername,
  ensureEmployeeLoginUsername,
};
