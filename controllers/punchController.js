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

function mapPunchForApi(p) {
  return {
    id: String(p._id),
    employee_id: String(p.employeeId),
    employee_name: p.employeeName || null,
    punch_type: p.punchType,
    punch_time: p.punchTime,
    original_punch_time: p.originalPunchTime || null,
    notes: p.notes || null,
    created_by: p.createdBy ? String(p.createdBy) : null,
    approval_status: p.approvalStatus || 'none',
    punch_local_date: p.punchLocalDate || null,
    reviewed_at: p.reviewedAt || null,
  };
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

/**
 * Find the most recent prior local day with clock_in and no clock_out.
 * Same-day open shifts are handled by Clock Out (not this flow).
 */
async function findOpenShift(companyId, employeeId) {
  const tz = await getCompanyTimezone(companyId);
  const todayStr = getLocalDateStringInTz(new Date(), tz);
  const punches = await Punch.find({ companyId, employeeId })
    .sort({ punchTime: -1 })
    .limit(120)
    .lean();

  const byDay = {};
  for (const p of punches) {
    const day = p.punchLocalDate || getLocalDateStringInTz(p.punchTime, tz);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(p);
  }

  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));
  for (const day of days) {
    if (day >= todayStr) continue;
    const dayPunches = byDay[day];
    const clockIn = dayPunches
      .filter((p) => p.punchType === 'clock_in')
      .sort((a, b) => new Date(a.punchTime) - new Date(b.punchTime))[0];
    const clockOut = dayPunches.find((p) => p.punchType === 'clock_out');
    if (clockIn && !clockOut) {
      return {
        localDate: day,
        clockIn,
        clockInTime: clockIn.punchTime,
      };
    }
  }
  return null;
}

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

async function resolveTargetEmployeeId(companyId, user, employee_id) {
  let targetEmployeeId =
    user.role === 'manager' || user.role === 'super-admin'
      ? (employee_id || (user.employee_id ? String(user.employee_id) : null))
      : user.employee_id;
  if (!targetEmployeeId && (user.role === 'super-admin' || user.role === 'manager')) {
    const adminEmp = await getOrCreateAdminEmployee(companyId);
    targetEmployeeId = String(adminEmp._id);
  }
  return targetEmployeeId;
}

async function createPendingClockOut({
  companyId,
  emp,
  user,
  openShift,
  clockOutTimeRaw,
}) {
  const clockOutTime = await parsePunchTimeInput(clockOutTimeRaw, companyId);
  if (!clockOutTime) {
    const err = new Error('Invalid clock-out time');
    err.statusCode = 400;
    err.code = 'INVALID_CLOCK_OUT_TIME';
    throw err;
  }

  const tz = await getCompanyTimezone(companyId);
  const outLocalDate = getLocalDateStringInTz(clockOutTime, tz);
  if (outLocalDate !== openShift.localDate) {
    const err = new Error(`Clock-out must be on ${openShift.localDate} (the day you forgot to clock out).`);
    err.statusCode = 400;
    err.code = 'CLOCK_OUT_WRONG_DAY';
    throw err;
  }

  const clockInTime = new Date(openShift.clockInTime);
  if (clockOutTime <= clockInTime) {
    const err = new Error('Clock-out time must be after your clock-in time.');
    err.statusCode = 400;
    err.code = 'CLOCK_OUT_BEFORE_IN';
    throw err;
  }

  const now = new Date();
  if (clockOutTime > now) {
    const err = new Error('Clock-out time cannot be in the future.');
    err.statusCode = 400;
    err.code = 'CLOCK_OUT_IN_FUTURE';
    throw err;
  }

  await ensureNoDuplicatePunchTypeForLocalDay({
    companyId,
    employeeId: emp._id,
    punchType: 'clock_out',
    punchTime: clockOutTime,
  });

  return Punch.create({
    companyId,
    employeeId: emp._id,
    employeeName: emp.name,
    punchType: 'clock_out',
    punchTime: clockOutTime,
    punchLocalDate: outLocalDate,
    originalPunchTime: clockOutTime,
    notes: 'Employee-reported clock-out (pending manager approval)',
    createdBy: user.id,
    approvalStatus: 'pending',
    submittedBy: user.id,
  });
}

// POST /api/punch
async function createPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { employee_id, punch_type, notes, punch_time, resolve_missing_clock_out } = req.body;
  const user = req.session.user;

  const validTypes = ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'];
  if (!validTypes.includes(punch_type)) {
    return res.status(400).json({ error: 'Invalid punch type' });
  }

  const targetEmployeeId = await resolveTargetEmployeeId(companyId, user, employee_id);
  if (!targetEmployeeId) {
    return res.status(400).json({
      error: user.role === 'manager' || user.role === 'super-admin'
        ? 'To clock in from the dashboard, add yourself as an employee and link your manager account, or use Manual Punch and select yourself.'
        : 'Employee ID required',
    });
  }

  try {
    const emp = await Employee.findOne({ _id: targetEmployeeId, companyId, active: true }).lean();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    if (punch_type === 'clock_in') {
      const isManualHistorical =
        punch_time !== undefined && punch_time !== null && String(punch_time).trim();
      if (!isManualHistorical) {
        const openShift = await findOpenShift(companyId, emp._id);
        if (openShift) {
          const resolveTime =
            resolve_missing_clock_out &&
            (resolve_missing_clock_out.clock_out_time || resolve_missing_clock_out.clockOutTime);

          if (!resolveTime) {
            return res.status(409).json({
              error: 'It looks like you forgot to clock out on a previous day. Please enter the time you left, then you can clock in.',
              code: 'MISSING_CLOCK_OUT',
              open_local_date: openShift.localDate,
              clock_in_time: openShift.clockInTime,
              employee_id: String(emp._id),
              employee_name: emp.name,
            });
          }

          await createPendingClockOut({
            companyId,
            emp,
            user,
            openShift,
            clockOutTimeRaw: resolveTime,
          });
        }
      }
    }

    let punchTime = new Date();
    if (punch_time !== undefined && punch_time !== null && String(punch_time).trim()) {
      const parsed = await parsePunchTimeInput(punch_time, companyId);
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid punch time' });
      }
      punchTime = parsed;
    }

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
      approvalStatus: 'none',
    });

    const isEmployeePunch = user.role === 'employee';
    const isManagerSelfPunch =
      (user.role === 'manager' || user.role === 'super-admin') && !employee_id;
    if (isEmployeePunch || isManagerSelfPunch) {
      sendPunchNotification(emp.name, punch_type, punch.punchTime, companyId);
    }

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
    return res.json(punches.map(mapPunchForApi));
  } catch (err) {
    console.error('listPunches error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function listPendingCorrections(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;

  try {
    const tz = await getCompanyTimezone(companyId);
    const todayStr = getLocalDateStringInTz(new Date(), tz);

    const pendingPunches = await Punch.find({
      companyId,
      approvalStatus: 'pending',
      punchType: 'clock_out',
    })
      .sort({ punchTime: -1 })
      .limit(200)
      .lean();

    const pendingItems = pendingPunches.map((p) => ({
      ...mapPunchForApi(p),
      kind: 'pending_approval',
    }));

    // Open shifts from prior days (clock in, no clock out) — alert managers even before employee submits
    const lookback = new Date();
    lookback.setUTCDate(lookback.getUTCDate() - 45);
    const recentPunches = await Punch.find({
      companyId,
      punchTime: { $gte: lookback },
      punchType: { $in: ['clock_in', 'clock_out'] },
    })
      .sort({ punchTime: 1 })
      .lean();

    const byEmpDay = new Map();
    for (const p of recentPunches) {
      const day = p.punchLocalDate || getLocalDateStringInTz(p.punchTime, tz);
      if (!day || day >= todayStr) continue;
      const key = `${String(p.employeeId)}|${day}`;
      if (!byEmpDay.has(key)) {
        byEmpDay.set(key, {
          employeeId: p.employeeId,
          employeeName: p.employeeName || null,
          day,
          clockIn: null,
          clockOut: null,
        });
      }
      const row = byEmpDay.get(key);
      if (p.employeeName) row.employeeName = p.employeeName;
      if (p.punchType === 'clock_in') {
        if (!row.clockIn || new Date(p.punchTime) < new Date(row.clockIn.punchTime)) {
          row.clockIn = p;
        }
      }
      if (p.punchType === 'clock_out') {
        row.clockOut = p;
      }
    }

    const missingItems = [];
    for (const row of byEmpDay.values()) {
      if (!row.clockIn || row.clockOut) continue;
      // Skip if a pending clock-out already covers this day for this employee
      const hasPending = pendingItems.some(
        (item) =>
          item.employee_id === String(row.employeeId) &&
          (item.punch_local_date === row.day ||
            getLocalDateStringInTz(item.punch_time, tz) === row.day)
      );
      if (hasPending) continue;

      missingItems.push({
        kind: 'missing_clock_out',
        id: `missing-${String(row.employeeId)}-${row.day}`,
        employee_id: String(row.employeeId),
        employee_name: row.employeeName || 'Employee',
        punch_type: 'clock_out',
        punch_time: null,
        punch_local_date: row.day,
        clock_in_time: row.clockIn.punchTime,
        notes: 'No clock-out recorded',
        approval_status: 'missing',
      });
    }

    missingItems.sort((a, b) => String(b.punch_local_date).localeCompare(String(a.punch_local_date)));

    const items = [...pendingItems, ...missingItems];
    return res.json({
      count: items.length,
      pending_count: pendingItems.length,
      missing_count: missingItems.length,
      items,
    });
  } catch (err) {
    console.error('listPendingCorrections error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

/** Manager sets a clock-out for an open prior-day shift (no employee estimate yet). */
async function resolveMissingClockOut(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  const user = req.session.user;
  const { employee_id, local_date, clock_out_time } = req.body || {};

  if (!employee_id || !local_date || !clock_out_time) {
    return res.status(400).json({ error: 'employee_id, local_date, and clock_out_time are required' });
  }

  try {
    const emp = await Employee.findOne({ _id: employee_id, companyId, active: true }).lean();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const tz = await getCompanyTimezone(companyId);
    const todayStr = getLocalDateStringInTz(new Date(), tz);
    const day = String(local_date).trim().slice(0, 10);
    if (!day || day >= todayStr) {
      return res.status(400).json({ error: 'Can only set missing clock-out for a prior day.' });
    }

    const timeRaw = String(clock_out_time).includes('T')
      ? String(clock_out_time).trim()
      : `${day}T${String(clock_out_time).trim()}`;
    const clockOutTime = await parsePunchTimeInput(timeRaw, companyId);
    if (!clockOutTime) {
      return res.status(400).json({ error: 'Invalid clock-out time' });
    }

    const outDay = getLocalDateStringInTz(clockOutTime, tz);
    if (outDay !== day) {
      return res.status(400).json({ error: `Clock-out must be on ${day}.` });
    }

    const { startUtc, endUtc } = getUtcRangeForLocalDate(day, tz);
    const dayPunches = await Punch.find({
      companyId,
      employeeId: emp._id,
      $or: [
        { punchLocalDate: day },
        {
          $and: [
            { $or: [{ punchLocalDate: { $exists: false } }, { punchLocalDate: null }, { punchLocalDate: '' }] },
            { punchTime: { $gte: startUtc, $lte: endUtc } },
          ],
        },
      ],
    }).lean();

    const clockIn = dayPunches
      .filter((p) => p.punchType === 'clock_in')
      .sort((a, b) => new Date(a.punchTime) - new Date(b.punchTime))[0];
    const clockOut = dayPunches.find((p) => p.punchType === 'clock_out');
    if (!clockIn) {
      return res.status(400).json({ error: 'No clock-in found for that day.' });
    }
    if (clockOut) {
      return res.status(400).json({ error: 'A clock-out already exists for that day.' });
    }
    if (clockOutTime <= new Date(clockIn.punchTime)) {
      return res.status(400).json({ error: 'Clock-out time must be after clock-in.' });
    }

    await ensureNoDuplicatePunchTypeForLocalDay({
      companyId,
      employeeId: emp._id,
      punchType: 'clock_out',
      punchTime: clockOutTime,
    });

    const punch = await Punch.create({
      companyId,
      employeeId: emp._id,
      employeeName: emp.name,
      punchType: 'clock_out',
      punchTime: clockOutTime,
      punchLocalDate: day,
      originalPunchTime: clockOutTime,
      notes: 'Manager-entered clock-out (missing punch)',
      createdBy: user.id,
      approvalStatus: 'approved',
      reviewedBy: user.id,
      reviewedAt: new Date(),
    });

    return res.json({ success: true, punch: mapPunchForApi(punch.toObject ? punch.toObject() : punch) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate punch: this punch type was already recorded for that day.', code: 'DUPLICATE_PUNCH_TYPE_FOR_DAY' });
    }
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code, existing_punch_id: err.existingPunchId });
    }
    console.error('resolveMissingClockOut error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function reviewPendingPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  const user = req.session.user;
  const { id } = req.params;
  const { action, punch_time } = req.body || {};

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or reject' });
  }

  try {
    const punch = await Punch.findOne({ _id: id, companyId });
    if (!punch) return res.status(404).json({ error: 'Punch not found' });
    if (punch.approvalStatus !== 'pending') {
      return res.status(400).json({ error: 'This punch is not pending approval.' });
    }

    if (action === 'reject') {
      await Punch.deleteOne({ _id: punch._id, companyId });
      return res.json({ success: true, action: 'reject' });
    }

    if (punch_time !== undefined && punch_time !== null && String(punch_time).trim()) {
      const nextPunchTime = await parsePunchTimeInput(punch_time, companyId);
      if (!nextPunchTime || Number.isNaN(nextPunchTime.getTime())) {
        return res.status(400).json({ error: 'Invalid punch time' });
      }
      if (punch.originalPunchTime == null) {
        punch.originalPunchTime = punch.punchTime;
      }
      punch.punchTime = nextPunchTime;
      const tz = await getCompanyTimezone(companyId);
      punch.punchLocalDate = getLocalDateStringInTz(nextPunchTime, tz);

      await ensureNoDuplicatePunchTypeForLocalDay({
        companyId,
        employeeId: punch.employeeId,
        punchType: punch.punchType,
        punchTime: nextPunchTime,
        excludePunchId: punch._id,
      });
    }

    punch.approvalStatus = 'approved';
    punch.reviewedBy = user.id;
    punch.reviewedAt = new Date();
    const notePrefix = 'Manager-approved employee clock-out';
    if (!punch.notes || !String(punch.notes).includes('Manager-approved')) {
      punch.notes = punch.notes
        ? `${punch.notes} · ${notePrefix}`
        : notePrefix;
    }

    await punch.save();
    return res.json({ success: true, action: 'approve', punch: mapPunchForApi(punch.toObject()) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate punch: this punch type was already recorded for that day.', code: 'DUPLICATE_PUNCH_TYPE_FOR_DAY' });
    }
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code, existing_punch_id: err.existingPunchId });
    }
    console.error('reviewPendingPunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function getPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;

  try {
    const punch = await Punch.findOne({ _id: id, companyId }).lean();
    if (!punch) return res.status(404).json({ error: 'Punch not found' });
    return res.json(mapPunchForApi(punch));
  } catch (err) {
    console.error('getPunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

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

    await ensureNoDuplicatePunchTypeForLocalDay({
      companyId,
      employeeId: punch.employeeId,
      punchType: nextPunchType,
      punchTime: nextPunchTime,
      excludePunchId: punch._id,
    });

    const tz = await getCompanyTimezone(companyId);
    punch.punchLocalDate = getLocalDateStringInTz(nextPunchTime, tz);

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
  listPendingCorrections,
  resolveMissingClockOut,
  reviewPendingPunch,
  getPunch,
  updatePunch,
  deletePunch,
  getCompanyAdminEmployee,
};
