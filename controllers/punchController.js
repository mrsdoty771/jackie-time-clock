const Punch = require('../models/Punch');
const Employee = require('../models/Employee');

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

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

  // Employees can only punch themselves, managers can punch anyone
  const targetEmployeeId = user.role === 'manager' ? employee_id : user.employee_id;
  if (!targetEmployeeId) return res.status(400).json({ error: 'Employee ID required' });

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

    return res.json({ success: true, id: String(punch._id) });
  } catch (err) {
    console.error('createPunch error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/punches
// Query: employee_id?, start_date?, end_date?
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

    const start = parseDateOnly(start_date);
    const end = parseDateOnly(end_date);
    if (start || end) {
      filter.punchTime = {};
      if (start) filter.punchTime.$gte = start;
      if (end) {
        // inclusive end-date
        const endInclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1);
        filter.punchTime.$lte = endInclusive;
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

module.exports = { createPunch, listPunches, deletePunch };

