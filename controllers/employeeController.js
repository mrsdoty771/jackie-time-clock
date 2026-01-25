const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Employee = require('../models/Employee');
const User = require('../models/User');

function normalizeStatus(status) {
  if (!status) return 'active';
  const s = String(status).toLowerCase();
  if (s === 'active' || s === 'inactive' || s === 'all') return s;
  return 'active';
}

// GET /api/employees/public?companyId=...
// Public endpoint used on the login screen dropdown.
async function listPublicEmployees(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = String(req.query.companyId || '').trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  try {
    const employees = await Employee.find({ companyId, active: true })
      .select('_id name employeeNumber')
      .sort({ name: 1 })
      .lean();

    return res.json(
      employees.map((e) => ({
        id: String(e._id),
        name: e.name,
        employee_number: e.employeeNumber,
      }))
    );
  } catch (err) {
    console.error('listPublicEmployees error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/employees?status=active|inactive|all
async function listEmployees(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const status = normalizeStatus(req.query.status);
  const companyId = req.companyId;

  try {
    // Employees can only see themselves
    if (req.session.user.role === 'employee') {
      if (!req.session.user.employee_id) return res.json([]);

      const emp = await Employee.findOne({
        _id: req.session.user.employee_id,
        companyId,
        active: true,
      })
        .select('_id name employeeNumber')
        .lean();

      if (!emp) return res.json([]);

      return res.json([
        { id: String(emp._id), name: emp.name, employee_number: emp.employeeNumber },
      ]);
    }

    const filter = { companyId };
    if (status === 'active') filter.active = true;
    if (status === 'inactive') filter.active = false;

    const employees = await Employee.find(filter).sort({ name: 1 }).lean();

    return res.json(
      employees.map((e) => ({
        id: String(e._id),
        name: e.name,
        employee_number: e.employeeNumber,
        email: e.email || null,
        phone: e.phone || null,
        active: e.active ? 1 : 0,
      }))
    );
  } catch (err) {
    console.error('listEmployees error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// POST /api/employees  (manager only)
async function createEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { name, employee_number, email, phone } = req.body;

  if (!name || !employee_number) {
    return res.status(400).json({ error: 'Name and employee number are required' });
  }

  try {
    const employee = await Employee.create({
      companyId,
      name: String(name).trim(),
      employeeNumber: String(employee_number).trim(),
      email: email ? String(email).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      active: true,
    });

    // Create user account for employee (username = employee number)
    // Generate a one-time temporary password (do NOT hardcode passwords in code).
    const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    const defaultPasswordHash = bcrypt.hashSync(tempPassword, 10);
    await User.create({
      companyId,
      username: String(employee_number).trim(),
      password: defaultPasswordHash,
      role: 'employee',
      employeeId: employee._id,
    });

    return res.json({ success: true, id: String(employee._id), temp_password: tempPassword });
  } catch (err) {
    console.error('createEmployee error:', err);
    // Duplicate key errors from unique index
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'Employee number already exists' });
    }
    return res.status(500).json({ error: 'Database error' });
  }
}

// PUT /api/employees/:id (manager only)
async function updateEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;
  const { name, employee_number, email, phone, active } = req.body;

  if (!name || !employee_number) {
    return res.status(400).json({ error: 'Name and employee number are required' });
  }

  try {
    const isActive = active === undefined ? undefined : !!(active === true || active === 1 || active === '1');

    const employee = await Employee.findOne({ _id: id, companyId });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const oldEmployeeNumber = employee.employeeNumber;

    employee.name = String(name).trim();
    employee.employeeNumber = String(employee_number).trim();
    employee.email = email ? String(email).trim() : undefined;
    employee.phone = phone ? String(phone).trim() : undefined;
    if (isActive !== undefined) employee.active = isActive;

    await employee.save();

    // Update employee user username if employee number changed
    if (String(oldEmployeeNumber) !== String(employee.employeeNumber)) {
      await User.updateOne(
        { companyId, employeeId: employee._id, role: 'employee' },
        { $set: { username: employee.employeeNumber } }
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('updateEmployee error:', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'Employee number already exists' });
    }
    return res.status(500).json({ error: 'Database error' });
  }
}

// PUT /api/employees/:id/password (manager only)
async function setEmployeePassword(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;
  const { password } = req.body;

  if (!password || String(password).trim().length === 0) {
    return res.status(400).json({ error: 'Password is required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const employee = await Employee.findOne({ _id: id, companyId }).select('_id').lean();
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const hashed = bcrypt.hashSync(String(password), 10);
    const result = await User.updateOne(
      { companyId, employeeId: employee._id, role: 'employee' },
      { $set: { password: hashed } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ error: 'Employee user account not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('setEmployeePassword error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// DELETE /api/employees/:id (manager only) -> soft deactivate
async function deactivateEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { id } = req.params;

  try {
    const result = await Employee.updateOne({ _id: id, companyId }, { $set: { active: false } });
    if (!result.matchedCount) return res.status(404).json({ error: 'Employee not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('deactivateEmployee error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  listPublicEmployees,
  listEmployees,
  createEmployee,
  updateEmployee,
  setEmployeePassword,
  deactivateEmployee,
};

