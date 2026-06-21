const Punch = require('../models/Punch');
const Employee = require('../models/Employee');
const { sendPunchNotification } = require('../utils/sms');
const { getCompanyTimezone, getUtcRangeForLocalDate, parsePunchTimeInput } = require('../utils/timezone');

const { SYSTEM_CLOCK_EMPLOYEE_NUMBER } = require('../utils/systemEmployee');

function getLocalDateStringInTz(date, tz) {
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

async function ensureNoDuplicatePunchTypeForLocalDay({
  companyId,
  employeeId,
  punchType,
  punchTime,
  excludePunchId = null,
}) {
  const tz = await getCompanyTimezone(companyId);
  const localDateStr = getLocalDateStringInTz(punchTime, tz);
  if (!localDateStr) {
    const err = new Error('Invalid punch time');
    err.statusCode = 400;
    throw err;
  }

  const { startUtc, endUtc } = getUtcRangeForLocalDate(localDateStr, tz);
  // Backward-compatible duplicate detection:
  // - Preferred path: punchLocalDate matches
  // - Legacy path: older rows without punchLocalDate, compare by local-day UTC range
  const filter = {
    companyId,
    employeeId,
    punchType,
    $or: [
      { punchLocalDate: localDateStr },
      {
        $and: [
          { $or: [{ punchLocalDate: { $exists: false } }, { punchLocalDate: null }, { punchLocalDate: '' }] },
          { punchTime: { $gte: startUtc, $lte: endUtc } },
        ],
      },
    ],
  };
  if (excludePunchId) {
    filter._id = { $ne: excludePunchId };
  }
  const existing = await Punch.findOne(filter).select({ _id: 1, punchTime: 1 }).lean();
  if (existing) {
    const err = new Error('Duplicate punch: this punch type was already recorded for that day.');
    err.statusCode = 409;
    err.code = 'DUPLICATE_PUNCH_TYPE_FOR_DAY';
    err.existingPunchId = String(existing._id);
    throw err;
  }
}

/** Get or create the company's "Admin" employee used for super-admin My Clock when not linked to a personal employee. */
async function getOrCreateAdminEmployee(companyId) {
  let emp = await Employee.findOne({ companyId, employeeNumber: SYSTEM_CLOCK_EMPLOYEE_NUMBER }).lean();
  if (!emp) {
    const created = await Employee.create({
      companyId,
      name: 'Admin',
      employeeNumber: SYSTEM_CLOCK_EMPLOYEE_NUMBER,
      active: true,
    });
    emp = created.toObject ? created.toObject() : created;
  }
  return emp;
}

// POST /api/punch
// Body: { punch_type, notes, employee_id?, punch_time? }
async function createPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { employee_id, punch_type, notes, punch_time } = req.body;
  const user = req.session.user;

  const validTypes = ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'];
  if (!validTypes.includes(punch_type)) {
    return res.status(400).json({ error: 'Invalid punch type' });
  }

  // Employees punch themselves; managers/super-admin can punch someone (employee_id) or themselves (omit employee_id)
  let targetEmployeeId =
    user.role === 'manager' || user.role === 'super-admin'
      ? (employee_id || (user.employee_id ? String(user.employee_id) : null))
      : user.employee_id;
  // Manager or super-admin without a linked employee uses the company's "Admin" employee so they can punch from My Clock without adding themselves
  if (!targetEmployeeId && (user.role === 'super-admin' || user.role === 'manager')) {
    const adminEmp = await getOrCreateAdminEmployee(companyId);
    targetEmployeeId = String(adminEmp._id);
  }
  if (!targetEmployeeId) {
    return res.status(400).json({
      error: user.role === 'manager' || user.role === 'super-admin'
        ? 'To clock in from the dashboard, add yourself as an employee and link your manager account, or use Manual Punch and select yourself.'
        : 'Employee ID required',
    });
  }

  try {
    // Ensure employee belongs to this company and is active
    const emp = await Employee.findOne({ _id: targetEmployeeId, companyId, active: true }).lean();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    let punchTime = new Date();
    if (punch_time !== undefined && punch_time !== null && String(punch_time).trim()) {
      const parsed = await parsePunchTimeInput(punch_time, companyId);
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid punch time' });
      }
      punchTime = parsed;
    }

    // Enforce: only one of each punch type per employee per local day (company timezone)
    await ensureNoDuplicatePunchTypeForLocalDay({
      companyId,
      employeeId: emp._id,
      punchType: punch_type,
      punchTime,
    });

    const tz = await getCompanyTimezone(companyId);
    const punchLocalDate = getLocalDateStringInTz(punchTime, tz);

    const punch = await Punch.create({
      companyId,
      employeeId: emp._id,
      employeeName: emp.name,
      punchType: punch_type,
      punchTime,
      punchLocalDate,
      originalPunchTime: punchTime,
      notes: notes || null,
      createdBy: user.id,
    });

    sendPunchNotification(emp.name, punch_type, punch.punchTime, companyId);

    return res.json({ success: true, id: String(punch._id) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate punch: this punch type was already recorded for that day.', code: 'DUPLICATE_PUNCH_TYPE_FOR_DAY' });
    }
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code, existing_punch_id: err.existingPunchId });
    }
    console.error('createPunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/punches
// Query: employee_id?, start_date?, end_date? (dates interpreted in company timezone)
async function listPunches(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const user = req.session.user;
  const { employee_id, start_date, end_date } = req.query;

  try {
    const filter = { companyId };

    if (user.role === 'employee') {
      filter.employeeId = user.employee_id;
    } else if (employee_id) {
      filter.employeeId = employee_id;
    }

    const tz = await getCompanyTimezone(companyId);
    if (start_date || end_date) {
      filter.punchTime = {};
      if (start_date) {
        const { startUtc } = getUtcRangeForLocalDate(String(start_date).trim().slice(0, 10), tz);
        filter.punchTime.$gte = startUtc;
      }
      if (end_date) {
        const { endUtc } = getUtcRangeForLocalDate(String(end_date).trim().slice(0, 10), tz);
        filter.punchTime.$lte = endUtc;
      }
    }

    const punches = await Punch.find(filter).sort({ punchTime: -1 }).limit(500).lean();

    // Map to the shape the existing frontend expects
    return res.json(
      punches.map((p) => ({
        id: String(p._id),
        employee_id: String(p.employeeId),
        employee_name: p.employeeName || null,
        punch_type: p.punchType,
        punch_time: p.punchTime,
        original_punch_time: p.originalPunchTime || null,
        notes: p.notes || null,
        created_by: p.createdBy ? String(p.createdBy) : null,
      }))
    );
  } catch (err) {
    console.error('listPunches error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/punches/:id  (manager only) — single punch for editing
async function getPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;

  try {
    const punch = await Punch.findOne({ _id: id, companyId }).lean();
    if (!punch) return res.status(404).json({ error: 'Punch not found' });
    return res.json({
      id: String(punch._id),
      employee_id: String(punch.employeeId),
      employee_name: punch.employeeName || null,
      punch_type: punch.punchType,
      punch_time: punch.punchTime,
      original_punch_time: punch.originalPunchTime || null,
      notes: punch.notes || null,
    });
  } catch (err) {
    console.error('getPunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// PUT /api/punches/:id  (manager only) — update punch type, time, notes
async function updatePunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;
  const { punch_type, punch_time, notes } = req.body || {};

  try {
    const punch = await Punch.findOne({ _id: id, companyId });
    if (!punch) return res.status(404).json({ error: 'Punch not found' });

    const validTypes = ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'];
    const nextPunchType = punch_type !== undefined ? punch_type : punch.punchType;
    let nextPunchTime = punch_time !== undefined ? await parsePunchTimeInput(punch_time, companyId) : new Date(punch.punchTime);

    if (punch_type !== undefined) {
      if (!validTypes.includes(punch_type)) return res.status(400).json({ error: 'Invalid punch type' });
      punch.punchType = punch_type;
    }
    if (punch_time !== undefined) {
      if (!nextPunchTime || Number.isNaN(nextPunchTime.getTime())) {
        return res.status(400).json({ error: 'Invalid punch time' });
      }
      const t = nextPunchTime;
      const oldMs = punch.punchTime ? new Date(punch.punchTime).getTime() : null;
      if (oldMs != null && t.getTime() !== oldMs) {
        if (punch.originalPunchTime == null) {
          punch.originalPunchTime = punch.punchTime;
        }
      }
      punch.punchTime = t;
    }
    if (notes !== undefined) punch.notes = notes ? String(notes).trim() : null;

    // Enforce: only one of each punch type per employee per local day (company timezone)
    await ensureNoDuplicatePunchTypeForLocalDay({
      companyId,
      employeeId: punch.employeeId,
      punchType: nextPunchType,
      punchTime: nextPunchTime,
      excludePunchId: punch._id,
    });

    const tz = await getCompanyTimezone(companyId);
    const nextLocalDate = getLocalDateStringInTz(nextPunchTime, tz);
    punch.punchLocalDate = nextLocalDate;

    await punch.save();
    return res.json({ success: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate punch: this punch type was already recorded for that day.', code: 'DUPLICATE_PUNCH_TYPE_FOR_DAY' });
    }
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code, existing_punch_id: err.existingPunchId });
    }
    console.error('updatePunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// DELETE /api/punches/:id  (manager only)
async function deletePunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;

  try {
    const result = await Punch.deleteOne({ _id: id, companyId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Punch not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('deletePunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/company-admin-employee — returns the "Admin" employee for the current company (for manager/super-admin My Clock when not linked)
async function getCompanyAdminEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  try {
    const emp = await getOrCreateAdminEmployee(companyId);
    return res.json({ employee_id: String(emp._id), name: emp.name });
  } catch (err) {
    console.error('getCompanyAdminEmployee error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  createPunch,
  listPunches,
  getPunch,
  updatePunch,
  deletePunch,
  getCompanyAdminEmployee,
};

