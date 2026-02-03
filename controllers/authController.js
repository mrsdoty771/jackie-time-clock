const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { encrypt, decrypt } = require('../utils/encrypt');

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
      if (!emp) return res.status(401).json({ error: 'User not found. Check Company ID and name.' });

      employeeName = emp.name;
      employeeId = String(emp._id);

      user = await User.findOne({ companyId, employeeId: emp._id, role: 'employee' }).lean();
      if (!user) return res.status(401).json({ error: 'User not found. Check Company ID and name.' });
    } else if (username) {
      // Manager or super-admin login via username
      user = await User.findOne({
        companyId,
        username,
        role: { $in: ['manager', 'super-admin'] },
      }).lean();
      if (!user) return res.status(401).json({ error: 'User not found. Check Company ID and name.' });
    } else {
      return res.status(400).json({ error: 'Username or employee_id required' });
    }

    let passwordMatch = false;
    try {
      passwordMatch = bcrypt.compareSync(password, user.password);
    } catch (bcryptErr) {
      console.error('Password check error (invalid hash?):', bcryptErr.message);
      return res.status(500).json({
        error: 'Account setup error. Your account may need to be reset - please contact your administrator.',
      });
    }
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Wrong password. Please try again.' });
    }

    req.session.lastActivity = Date.now();
    req.session.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
      companyId: user.companyId,
      employee_id: employeeId || (user.employeeId ? String(user.employeeId) : null),
      employee_name: employeeName || null,
      name: user.name || null,
      email: user.email || null,
      ext: user.ext || null,
    };

    return res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err.message || err);
    const msg = err.message || String(err);
    if (msg.includes('buffering timed out') || msg.includes('Authentication failed')) {
      return res.status(503).json({
        error: 'Database unavailable. Please check that DATABASE_URL is set correctly in your deployment.',
      });
    }
    return res.status(500).json({
      error: 'Server error. Check the server logs for details.',
    });
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

// GET /api/profile — current user's profile (name, email, ext) for manager/self
async function getProfile(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const uid = req.session?.user?.id;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = await User.findOne({ _id: uid, companyId: req.session.user.companyId })
      .select('username name email ext role displayName smtpHost smtpPort smtpSecure smtpUser smtpPassEncrypted defaultEmailBody')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    let smtpPassword = '';
    if (user.smtpPassEncrypted) {
      try {
        smtpPassword = decrypt(user.smtpPassEncrypted);
      } catch (_) {
        // leave smtpPassword empty if decrypt fails
      }
    }
    return res.json({
      id: String(user._id),
      username: user.username,
      name: user.name || '',
      email: user.email || '',
      ext: user.ext || '',
      role: user.role,
      displayName: user.displayName || '',
      smtpHost: user.smtpHost || '',
      smtpPort: user.smtpPort ?? '',
      smtpSecure: !!user.smtpSecure,
      smtpUser: user.smtpUser || '',
      smtpPassword,
      defaultEmailBody: user.defaultEmailBody || '',
    });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// PUT /api/profile — update current user's name, email, ext, password, and e-mail setup
async function updateProfile(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const uid = req.session?.user?.id;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
  const {
    name, email, ext, newPassword,
    displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, defaultEmailBody,
  } = req.body || {};
  try {
    const user = await User.findOne({ _id: uid, companyId: req.session.user.companyId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (name !== undefined) user.name = String(name).trim() || null;
    if (email !== undefined) user.email = String(email).trim().toLowerCase() || null;
    if (ext !== undefined) user.ext = String(ext).trim() || null;
    if (newPassword && String(newPassword).trim()) {
      user.password = bcrypt.hashSync(String(newPassword).trim(), 10);
    }
    if (displayName !== undefined) user.displayName = String(displayName).trim() || null;
    if (smtpHost !== undefined) user.smtpHost = String(smtpHost).trim() || null;
    if (smtpPort !== undefined) user.smtpPort = smtpPort === '' || smtpPort === null ? null : parseInt(smtpPort, 10);
    if (smtpSecure !== undefined) user.smtpSecure = !!smtpSecure;
    if (smtpUser !== undefined) user.smtpUser = String(smtpUser).trim().toLowerCase() || null;
    if (smtpPassword !== undefined && String(smtpPassword).trim()) {
      user.smtpPassEncrypted = encrypt(String(smtpPassword).trim());
    }
    if (defaultEmailBody !== undefined) user.defaultEmailBody = String(defaultEmailBody).trim() || null;
    user.markModified('displayName');
    user.markModified('smtpHost');
    user.markModified('smtpPort');
    user.markModified('smtpSecure');
    user.markModified('smtpUser');
    user.markModified('smtpPassEncrypted');
    user.markModified('defaultEmailBody');
    await user.save();
    req.session.user = { ...req.session.user, name: user.name, email: user.email, ext: user.ext };
    return res.json({ success: true, message: 'Profile updated.' });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}

// POST /api/profile/test-email — send test email using manager's saved SMTP or .env (manager only)
async function testEmail(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const uid = req.session?.user?.id;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
  const to = req.body && typeof req.body.to === 'string' ? req.body.to.trim() : '';
  if (!to) return res.status(400).json({ error: 'Recipient email (to) is required' });
  try {
    const user = await User.findOne({ _id: uid, companyId: req.session.user.companyId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    let transporter;
    let fromField;
    const useManagerSmtp = user.smtpHost && user.smtpUser && user.smtpPassEncrypted;
    let smtpPass = null;
    if (useManagerSmtp) {
      try {
        smtpPass = decrypt(user.smtpPassEncrypted);
      } catch (decErr) {
        console.error('testEmail decrypt error:', decErr);
        return res.status(500).json({ error: 'Saved email password could not be read. Save your E-mail Password again in My Account.' });
      }
    }
    if (useManagerSmtp && smtpPass) {
      const port = Number(user.smtpPort) || 587;
      // Port 465 = implicit SSL; 587/25 = STARTTLS (secure: false to avoid "wrong version number")
      const secure = port === 465;
      const host = (user.smtpHost || '').toLowerCase();
      transporter = nodemailer.createTransport({
        host: user.smtpHost,
        port,
        secure,
        requireTLS: !secure && (host.includes('office365') || host.includes('gmail') || true),
        auth: { user: user.smtpUser, pass: smtpPass },
      });
      const fromName = (user.displayName || user.name || '').trim();
      fromField = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${user.smtpUser}>` : user.smtpUser;
    } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const secure = port === 465; // 587/25 use STARTTLS, not implicit SSL
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      fromField = process.env.SMTP_FROM || process.env.SMTP_USER;
    } else {
      return res.status(503).json({ error: 'No email configured. Set up E-mail Address Setup in My Account (and save), or add SMTP_USER and SMTP_PASS to .env.' });
    }
    await transporter.sendMail({
      from: fromField,
      to,
      subject: 'Time Clock – Test Email',
      text: 'This is a test email from the Time Clock application. Your email settings are working.',
    });
    return res.json({ success: true, message: 'Test email sent.' });
  } catch (err) {
    console.error('testEmail error:', err);
    let msg = (err.response && String(err.response).trim()) || err.message || 'Failed to send test email';
    // Office 365 / Outlook: 535 usually means use an App password, not your normal password
    if (/535|Authentication unsuccessful|credentials were incorrect/i.test(msg) && /outlook|office365|microsoft/i.test(msg)) {
      msg = 'Office 365 rejected the login. Use an App password instead of your account password: Microsoft account → Security → Advanced security options → App passwords. Then save that password in E-mail Address Setup.';
    }
    return res.status(500).json({ error: msg });
  }
}

// GET /api/login-options — public; returns super-admin login option if env is set
function getLoginOptions(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = String(process.env.SUPER_ADMIN_COMPANY_ID || '').trim();
  const username = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  if (!companyId || !username) {
    return res.json({ superAdmin: null });
  }
  return res.json({ superAdmin: { companyId, username } });
}

module.exports = { login, logout, me, getProfile, updateProfile, testEmail, getLoginOptions };

