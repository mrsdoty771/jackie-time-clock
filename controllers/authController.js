const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Employee = require('../models/Employee');

function normalizeCompanyId(raw) {
  const companyId = String(raw || '').trim();
  return companyId.length ? companyId : null;
}

// POST /api/login
// Supports:
// - manager login via { username, password, companyId }
// - employee login via { employee_id, password, companyId }
async function login(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const { username, password, employee_id } = req.body;
  const companyId = normalizeCompanyId(req.body.companyId);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    let user = null;
    let employeeName = null;
    let employeeId = null;

    if (employee_id) {
      // Employee login via employee id
      const emp = await Employee.findOne({ _id: employee_id, companyId, active: true }).lean();
      if (!emp) return res.status(401).json({ error: 'Invalid credentials' });

      employeeName = emp.name;
      employeeId = String(emp._id);

      user = await User.findOne({ companyId, employeeId: emp._id, role: 'employee' }).lean();
    } else if (username) {
      // Manager login via username
      user = await User.findOne({ companyId, username, role: 'manager' }).lean();
    } else {
      return res.status(400).json({ error: 'Username or employee_id required' });
    }

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
      companyId: user.companyId,
      employee_id: employeeId || (user.employeeId ? String(user.employeeId) : null),
      employee_name: employeeName || null,
    };

    return res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// POST /api/logout
function logout(req, res) {
  res.setHeader('Content-Type', 'application/json');
  req.session.destroy(() => res.json({ success: true }));
}

// GET /api/me
function me(req, res) {
  res.setHeader('Content-Type', 'application/json');
  return res.json({ user: req.session?.user || null });
}

module.exports = { login, logout, me };

