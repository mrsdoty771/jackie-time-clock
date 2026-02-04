const Punch = require('../models/Punch');
const Employee = require('../models/Employee');
const { sendPunchNotification } = require('../utils/sms');
const { getCompanyTimezone, getUtcRangeForLocalDate } = require('../utils/timezone');

// POST /api/punch
// Body: { punch_type, notes, employee_id? }
async function createPunch(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { employee_id, punch_type, notes } = req.body;
  const user = req.session.user;

  const validTypes = ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'];
  if (!validTypes.includes(punch_type)) {
    return res.status(400).json({ error: 'Invalid punch type' });
  }

  // Employees punch themselves; managers can punch someone (employee_id) or themselves (omit employee_id)
  let targetEmployeeId =
    user.role === 'manager'
      ? (employee_id || (user.employee_id ? String(user.employee_id) : null))
      : user.employee_id;
  if (!targetEmployeeId) {
    return res.status(400).json({
      error: user.role === 'manager'
        ? 'To clock in from the dashboard, add yourself as an employee and link your manager account, or use Manual Punch and select yourself.'
        : 'Employee ID required',
    });
  }

  try {
    // Ensure employee belongs to this company and is active
    const emp = await Employee.findOne({ _id: targetEmployeeId, companyId, active: true }).lean();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const punch = await Punch.create({
      companyId,
      employeeId: emp._id,
      employeeName: emp.name,
      punchType: punch_type,
      punchTime: new Date(),
      notes: notes || null,
      createdBy: user.id,
    });

    sendPunchNotification(emp.name, punch_type, punch.punchTime);

    return res.json({ success: true, id: String(punch._id) });
  } catch (err) {
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
    if (punch_type !== undefined) {
      if (!validTypes.includes(punch_type)) return res.status(400).json({ error: 'Invalid punch type' });
      punch.punchType = punch_type;
    }
    if (punch_time !== undefined) {
      const t = new Date(punch_time);
      if (Number.isNaN(t.getTime())) return res.status(400).json({ error: 'Invalid punch time' });
      punch.punchTime = t;
    }
    if (notes !== undefined) punch.notes = notes ? String(notes).trim() : null;

    await punch.save();
    return res.json({ success: true });
  } catch (err) {
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

module.exports = { createPunch, listPunches, getPunch, updatePunch, deletePunch };

