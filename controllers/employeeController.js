const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { encrypt, decrypt } = require('../utils/encrypt');

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
    const employeeIds = employees.map((e) => e._id);

    // For managers: which employees have a manager login?
    let managerMap = {};
    if (req.session.user.role === 'manager' || req.session.user.role === 'super-admin') {
      const managerUsers = await User.find({
        companyId,
        role: 'manager',
        employeeId: { $in: employeeIds },
      })
        .select('username employeeId')
        .lean();
      managerUsers.forEach((u) => {
        managerMap[String(u.employeeId)] = u.username || '';
      });
    }

    return res.json(
      employees.map((e) => {
        const out = {
          id: String(e._id),
          name: e.name,
          employee_number: e.employeeNumber,
          email: e.email || null,
          phone: e.phone || null,
          active: e.active ? 1 : 0,
        };
        if (managerMap[String(e._id)] !== undefined) {
          out.has_manager = true;
          out.manager_username = managerMap[String(e._id)];
        } else {
          out.has_manager = false;
          out.manager_username = null;
        }
        return out;
      })
    );
  } catch (err) {
    console.error('listEmployees error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/employees/:id (manager only) — single employee for edit, includes decrypted password for display
async function getEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  const { id } = req.params;
  try {
    const employee = await Employee.findOne({ _id: id, companyId }).lean();
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    const user = await User.findOne({ companyId, employeeId: employee._id, role: { $in: ['employee', 'manager'] } }).select('passwordDisplayEncrypted').lean();
    let password = '';
    if (user && user.passwordDisplayEncrypted) {
      try {
        password = decrypt(user.passwordDisplayEncrypted) || '';
      } catch (_) {}
    }
    const managerUser = await User.findOne({ companyId, employeeId: employee._id, role: 'manager' }).select('username').lean();
    return res.json({
      id: String(employee._id),
      name: employee.name || '',
      employee_number: employee.employeeNumber || '',
      email: employee.email || '',
      phone: employee.phone || '',
      active: employee.active ? 1 : 0,
      password,
      has_manager: !!managerUser,
      manager_username: managerUser ? managerUser.username : null,
    });
  } catch (err) {
    console.error('getEmployee error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// GET /api/employees/next-number  (manager only) — returns next auto-generated employee number
async function getNextEmployeeNumber(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  try {
    const existing = await Employee.find({ companyId }).select('employeeNumber').lean();
    let maxNum = 0;
    for (const e of existing || []) {
      const n = parseInt(e.employeeNumber, 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    const nextNumber = String(maxNum + 1).padStart(4, '0');
    return res.json({ nextNumber });
  } catch (err) {
    console.error('getNextEmployeeNumber error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// POST /api/employees  (manager only)
async function createEmployee(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  let { name, employee_number, email, phone, hire_date, password: initialPassword } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const hireDate = hire_date && String(hire_date).trim() ? new Date(hire_date) : undefined;
  if (hireDate && isNaN(hireDate.getTime())) {
    return res.status(400).json({ error: 'Invalid hire date' });
  }

  const raw = employee_number == null ? '' : String(employee_number).trim();
  const numTrimmed = (raw === '' || raw === 'undefined') ? '' : raw;
  if (!numTrimmed) {
    const existing = await Employee.find({ companyId }).select('employeeNumber').lean();
    let maxNum = 0;
    for (const e of existing || []) {
      const n = parseInt(e.employeeNumber, 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    employee_number = String(maxNum + 1).padStart(4, '0');
  } else {
    employee_number = numTrimmed;
  }

  try {
    const employee = await Employee.create({
      companyId,
      name: String(name).trim(),
      employeeNumber: String(employee_number),
      email: email ? String(email).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      hireDate: hireDate || undefined,
      active: true,
    });

    // Use manager-provided password if given; otherwise generate a temporary one.
    const passwordToUse = (initialPassword && String(initialPassword).trim()) || null;
    const tempPassword = passwordToUse || crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    const defaultPasswordHash = bcrypt.hashSync(tempPassword, 10);
    const passwordDisplayEncrypted = encrypt(tempPassword);
    await User.create({
      companyId,
      username: String(employee_number).trim(),
      password: defaultPasswordHash,
      passwordDisplayEncrypted: passwordDisplayEncrypted || undefined,
      role: 'employee',
      employeeId: employee._id,
    });

    const response = { success: true, id: String(employee._id) };
    if (!passwordToUse) response.temp_password = tempPassword;
    return res.json(response);
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
  const { name, employee_number, email, phone, active, password: newPassword } = req.body;

  if (!name || !employee_number) {
    return res.status(400).json({ error: 'Name and employee number are required' });
  }

  if (newPassword !== undefined && newPassword !== null && String(newPassword).trim().length > 0) {
    const pwd = String(newPassword).trim();
    if (pwd.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
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

    // Update employee user: username if employee number changed, and optional password
    const userUpdates = {};
    if (String(oldEmployeeNumber) !== String(employee.employeeNumber)) {
      userUpdates.username = employee.employeeNumber;
    }
    if (newPassword !== undefined && newPassword !== null && String(newPassword).trim().length > 0) {
      const pwdPlain = String(newPassword).trim();
      userUpdates.password = bcrypt.hashSync(pwdPlain, 10);
      const enc = encrypt(pwdPlain);
      if (enc) userUpdates.passwordDisplayEncrypted = enc;
    }
    if (Object.keys(userUpdates).length > 0) {
      const result = await User.updateOne(
        { companyId, employeeId: employee._id, role: { $in: ['employee', 'manager'] } },
        { $set: userUpdates }
      );
      if (result.matchedCount === 0 && Object.keys(userUpdates).length > 0) {
        return res.status(404).json({ error: 'Employee user account not found' });
      }
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
      { companyId, employeeId: employee._id, role: { $in: ['employee', 'manager'] } },
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

// POST /api/employees/:id/grant-manager (manager only) — upgrade this employee's account to manager role; they keep same login (name + password)
async function grantManager(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  let id = (req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Employee ID is required' });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid employee ID. Please select an employee from the list and try again.' });
    }
    const employeeId = new mongoose.Types.ObjectId(id);
    const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found. Make sure you selected an employee from the list and that they belong to your company.',
      });
    }

    const user = await User.findOne({ companyId, employeeId: employeeId, role: { $in: ['employee', 'manager'] } });
    if (!user) {
      console.warn('grantManager: no User for employee', id, companyId);
      return res.status(400).json({
        error: 'This employee does not have a login account. They may have been added before login was set up. Use Edit Employee to set a password for them first, then try Grant manager rights again.',
      });
    }

    if (user.role === 'manager') {
      return res.status(400).json({ error: 'This employee already has manager rights.' });
    }

    user.role = 'manager';
    await user.save();

    return res.json({ success: true, message: 'Manager rights granted. They will keep logging in with their name and password and will see the manager dashboard.' });
  } catch (err) {
    console.error('grantManager error:', err);
    return res.status(500).json({ error: 'Database error. Check the server terminal for details.' });
  }
}

// POST /api/employees/:id/revoke-manager (manager only) — set role back to employee; they keep same login
async function revokeManager(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  let id = (req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Employee ID is required' });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid employee ID. Please select an employee from the list and try again.' });
    }
    const employeeId = new mongoose.Types.ObjectId(id);
    const employee = await Employee.findOne({ _id: employeeId, companyId }).lean();
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found. Make sure you selected an employee from the list.',
      });
    }

    const result = await User.updateOne(
      { companyId, employeeId: employeeId, role: 'manager' },
      { $set: { role: 'employee' } }
    );
    if (!result.matchedCount) {
      return res.status(404).json({ error: 'This employee does not have manager rights.' });
    }

    return res.json({ success: true, message: 'Manager rights revoked. They will keep the same login and see the employee time clock.' });
  } catch (err) {
    console.error('revokeManager error:', err);
    return res.status(500).json({ error: 'Database error. Check the server terminal for details.' });
  }
}

module.exports = {
  listPublicEmployees,
  listEmployees,
  getNextEmployeeNumber,
  getEmployee,
  createEmployee,
  updateEmployee,
  setEmployeePassword,
  deactivateEmployee,
  grantManager,
  revokeManager,
};

