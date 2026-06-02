const User = require('../models/User');

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
    const query = { companyId, username: candidate };
    if (excludeUserId) query._id = { $ne: excludeUserId };
    const clash = await User.findOne(query).select('_id').lean();
    if (!clash) return candidate;
    candidate = `${base}${n + 1}`;
  }
  return `${base}${Date.now().toString(36)}`;
}

/**
 * Upgrade legacy login usernames that still match the employee number.
 * @returns {Promise<string>} The login username to use (may update the user record).
 */
async function ensureEmployeeLoginUsername(companyId, employee, user) {
  const empNum = String(employee?.employeeNumber || employee?.employee_number || '').trim();
  const stored = String(user?.username || '').trim();
  if (!usernameLooksLikeEmployeeNumber(stored, empNum)) {
    return stored;
  }
  const displayName = String(employee?.name || user?.name || '').trim();
  const newUsername = await allocateUniqueLoginUsername(companyId, displayName, empNum, user._id);
  if (typeof user.save === 'function') {
    user.username = newUsername;
    await user.save();
  } else {
    await User.updateOne({ _id: user._id, companyId }, { $set: { username: newUsername } });
    user.username = newUsername;
  }
  return newUsername;
}

module.exports = {
  suggestedLoginUsernameFromDisplayName,
  usernameLooksLikeEmployeeNumber,
  allocateUniqueLoginUsername,
  ensureEmployeeLoginUsername,
};
