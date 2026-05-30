const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Employee = require('../models/Employee');
const CompanySettings = require('../models/CompanySettings');
const { encrypt, decrypt } = require('../utils/encrypt');
const { redeemLoginInvite } = require('../utils/loginInvite');

function normalizeCompanyId(raw) {
  const companyId = String(raw || '').trim();
  return companyId.length ? companyId : null;
}

// #region agent log
function debugAgentLog(hypothesisId, message, data) {
  try {
    fs.appendFileSync(
      path.join(__dirname, '..', 'debug-46914f.log'),
      JSON.stringify({
        sessionId: '46914f',
        hypothesisId,
        location: 'authController.js:login',
        message,
        data: data || {},
        timestamp: Date.now(),
      }) + '\n'
    );
  } catch (_e) {}
}
// #endregion

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

/**
 * Resolve a User within companyId by username (exact) or email (case-insensitive).
 */
async function resolveUserByIdentifier(companyId, identifierRaw) {
  const identifier = String(identifierRaw || '').trim();
  if (!identifier) return { user: null, employeeName: null };

  let user = await User.findOne({ companyId, username: identifier }).lean();
  if (user) {
    let employeeName = null;
    if (user.employeeId) {
      const emp = await Employee.findOne({ _id: user.employeeId, companyId, active: true }).select('name').lean();
      employeeName = emp ? emp.name : null;
    }
    return { user, employeeName };
  }

  if (looksLikeEmail(identifier)) {
    const emailLower = identifier.toLowerCase();
    user = await User.findOne({ companyId, email: emailLower }).lean();
    if (user) {
      let employeeName = null;
      if (user.employeeId) {
        const emp = await Employee.findOne({ _id: user.employeeId, companyId, active: true }).select('name').lean();
        employeeName = emp ? emp.name : null;
      }
      return { user, employeeName };
    }

    const esc = emailLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emp = await Employee.findOne({
      companyId,
      active: true,
      email: new RegExp(`^${esc}$`, 'i'),
    })
      .select('_id name')
      .lean();
    if (emp) {
      user = await User.findOne({
        companyId,
        employeeId: emp._id,
        role: { $in: ['employee', 'manager', 'super-admin'] },
      }).lean();
      if (user) return { user, employeeName: emp.name };
    }
  }

  return { user: null, employeeName: null };
}

// POST /api/login
// Body: { username, password, companyId } — username is login name or email (legacy: identifier)
async function login(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const loginName = String(
    body.username != null && body.username !== '' ? body.username : body.identifier != null ? body.identifier : ''
  ).trim();
  const { password } = body;
  const companyId = normalizeCompanyId(body.companyId);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (!loginName) {
    return res.status(400).json({ error: 'Username or email is required' });
  }

  try {
    // #region agent log
    fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'authController.js:login',message:'login attempt',data:{companyId,hasDatabaseUrl:!!String(process.env.DATABASE_URL||'').trim(),readyState:mongoose.connection.readyState,loginLooksLikeEmail:looksLikeEmail(loginName)},timestamp:Date.now(),hypothesisId:'A,C'})}).catch(()=>{});
    // #endregion
    const { user, employeeName } = await resolveUserByIdentifier(companyId, loginName);
    if (!user) {
      // #region agent log
      debugAgentLog('H1-login-401', 'login returned 401 user not found', { reason: 'user_not_found' });
      // #endregion
      return res.status(401).json({ error: 'User not found. Check your username or email and company.' });
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
      // #region agent log
      debugAgentLog('H1-login-401', 'login returned 401 wrong password', { reason: 'wrong_password' });
      // #endregion
      return res.status(401).json({ error: 'Wrong password. Please try again.' });
    }

    const mustChange = !!user.mustChangePassword;
    const employeeId = user.employeeId ? String(user.employeeId) : null;

    req.session.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
      companyId: user.companyId,
      employee_id: employeeId,
      employee_name: employeeName || null,
      name: user.name || null,
      email: user.email || null,
      ext: user.ext || null,
      must_change_password: mustChange,
    };

    return res.json({
      success: true,
      user: req.session.user,
      must_change_password: mustChange,
    });
  } catch (err) {
    console.error('Login error:', err.message || err);
    const msg = err.message || String(err);
    // #region agent log
    fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'authController.js:login',message:'login error caught',data:{errName:err?.name,errMsg:msg.slice(0,300),readyState:mongoose.connection.readyState,isDbUnavailableMsg:msg.includes('buffering timed out')||msg.includes('Authentication failed')},timestamp:Date.now(),hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
    // #endregion
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
  const u = req.session?.user || null;
  if (!u) return res.json({ user: null });
  return res.json({
    user: {
      ...u,
      must_change_password: !!u.must_change_password,
    },
  });
}

// GET /api/profile — current user's profile (name, email, ext) for manager/self
async function getProfile(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const uid = req.session?.user?.id;
  if (!uid) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = await User.findOne({ _id: uid, companyId: req.session.user.companyId })
      .select('username name email ext role employeeId displayName smtpHost smtpPort smtpSecure smtpUser smtpPassEncrypted defaultEmailBody')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    let phone = '';
    if (user.employeeId) {
      const emp = await Employee.findOne({ _id: user.employeeId, companyId: req.session.user.companyId })
        .select('phone')
        .lean();
      phone = emp?.phone || '';
    }
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
      employee_id: user.employeeId ? String(user.employeeId) : null,
      phone,
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
    name, email, ext, newPassword, phone,
    displayName, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, defaultEmailBody,
    link_employee_id,
  } = req.body || {};
  try {
    const user = await User.findOne({ _id: uid, companyId: req.session.user.companyId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Managers/super-admins can link to an employee (for My Clock tab)
    if ((user.role === 'manager' || user.role === 'super-admin') && link_employee_id !== undefined) {
      const Employee = require('../models/Employee');
      if (link_employee_id === '' || link_employee_id == null) {
        user.employeeId = undefined;
      } else {
        const emp = await Employee.findOne({ _id: link_employee_id, companyId: req.session.user.companyId }).lean();
        if (!emp) return res.status(400).json({ error: 'Employee not found' });
        user.employeeId = emp._id;
      }
    }
    if (name !== undefined) user.name = String(name).trim() || null;
    if (email !== undefined) user.email = String(email).trim().toLowerCase() || null;
    if (ext !== undefined) user.ext = String(ext).trim() || null;
    if (newPassword && String(newPassword).trim()) {
      const pwd = String(newPassword).trim();
      if (pwd.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      user.password = bcrypt.hashSync(pwd, 10);
      user.mustChangePassword = false;
    }
    if (phone !== undefined && user.employeeId) {
      const emp = await Employee.findOne({ _id: user.employeeId, companyId: req.session.user.companyId });
      if (!emp) return res.status(404).json({ error: 'Employee record not found' });
      emp.phone = String(phone).trim() || undefined;
      await emp.save();
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
    const sessionUser = {
      ...req.session.user,
      name: user.name,
      email: user.email,
      ext: user.ext,
      must_change_password: !!user.mustChangePassword,
    };
    if (user.employeeId) sessionUser.employee_id = String(user.employeeId);
    else sessionUser.employee_id = null;
    req.session.user = sessionUser;
    return res.json({
      success: true,
      message: 'Profile updated.',
      employee_id: sessionUser.employee_id || null,
    });
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

// GET /api/login-options — public; returns super-admin and company managers for login dropdown
// Query: companyId (optional) — when set, returns managers for that company (username + name)
function getLoginOptions(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const superCompanyId = String(process.env.SUPER_ADMIN_COMPANY_ID || '').trim();
  const superUsername = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  const companyId = String(req.query.companyId || '').trim();

  const out = { superAdmin: superCompanyId && superUsername ? { companyId: superCompanyId, username: superUsername } : null };

  // Only return standalone managers (no employeeId) for dropdown; granted managers log in as employee (name + password)
  // Exclude a standalone manager only when an active employee has the same name AND that employee's role is 'employee' (manager rights were revoked) — so they appear once as employee, not as "(Manager)"
  if (companyId) {
    User.find({ companyId, role: 'manager', employeeId: null })
      .select('username name')
      .lean()
      .then((users) => {
        return Promise.all([
          Employee.find({ companyId, active: true }).select('_id name').lean(),
          Employee.find({ companyId, active: false }).select('name').lean(),
          CompanySettings.findOne({ companyId }).select('companyAdminEmployeeId').lean(),
        ]).then(([employees, inactiveEmployees, settings]) => {
            const employeeIds = (employees || []).map((e) => e._id);
            return User.find({
              companyId,
              employeeId: { $in: employeeIds },
              role: 'employee',
            })
              .select('employeeId')
              .lean()
              .then((employeeOnlyUsers) => {
                const employeeOnlyIds = new Set(
                  (employeeOnlyUsers || []).map((u) => String(u.employeeId))
                );
                const namesOfRevokedOrEmployeeOnly = new Set(
                  (employees || [])
                    .filter((e) => employeeOnlyIds.has(String(e._id)))
                    .map((e) => (e.name || '').trim().toLowerCase())
                    .filter(Boolean)
                );
                const hiddenUserNames = new Set(
                  (process.env.LOGIN_HIDE_MANAGER_USERNAMES || 'Josh')
                    .split(',')
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean)
                );
                const inactiveNamesLower = new Set(
                  (inactiveEmployees || []).map((e) => (e.name || '').trim().toLowerCase()).filter(Boolean)
                );
                const companyAdminEmployeeId = settings?.companyAdminEmployeeId
                  ? String(settings.companyAdminEmployeeId)
                  : '';
                const employeeById = new Map((employees || []).map((e) => [String(e._id), e]));
                const companyAdminEmployeeName = companyAdminEmployeeId && employeeById.get(companyAdminEmployeeId)
                  ? String(employeeById.get(companyAdminEmployeeId).name || '').trim()
                  : '';
                let managerList = (users || [])
                  .map((u) => ({
                    username: u.username,
                    name: (() => {
                      const rawName = String(u.name || '').trim();
                      if (rawName) return rawName;
                      if (String(u.username || '').trim().toLowerCase() === 'admin' && companyAdminEmployeeName) {
                        return companyAdminEmployeeName;
                      }
                      return u.username;
                    })(),
                  }))
                  .filter(
                    (m) =>
                      !namesOfRevokedOrEmployeeOnly.has((m.name || m.username || '').trim().toLowerCase()) &&
                      !hiddenUserNames.has((m.username || '').trim().toLowerCase())
                  );
                // Hide standalone managers whose name matches an inactive employee (they should not appear on login)
                managerList = managerList.filter(
                  (m) => !inactiveNamesLower.has((m.name || m.username || '').trim().toLowerCase())
                );
                out.managers = managerList;
                return res.json(out);
              });
          });
      })
      .catch((err) => {
        console.error('getLoginOptions managers:', err);
        out.managers = [];
        return res.json(out);
      });
    return;
  }

  out.managers = [];
  return res.json(out);
}

// POST /api/forgot-password — public; reset password by companyId + username (or email)
// Body: { companyId, username, newPassword, confirmPassword } (legacy: identifier, employee_id)
async function resetPassword(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const companyId = normalizeCompanyId(body.companyId);
  const loginName = String(
    body.username != null && body.username !== '' ? body.username : body.identifier != null ? body.identifier : ''
  ).trim();
  const { employee_id, newPassword, confirmPassword } = body;

  if (!companyId) {
    return res.status(400).json({ error: 'Company ID is required' });
  }
  if (!newPassword || String(newPassword).trim().length === 0) {
    return res.status(400).json({ error: 'New password is required' });
  }
  if (String(newPassword).trim().length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    let user = null;
    if (employee_id) {
      const emp = await Employee.findOne({ _id: employee_id, companyId, active: true }).lean();
      if (!emp) {
        return res.status(404).json({ error: 'User not found. Check Company ID and name.' });
      }
      user = await User.findOne({
        companyId,
        employeeId: emp._id,
        role: { $in: ['employee', 'manager'] },
      });
    } else if (loginName) {
      const resolved = await resolveUserByIdentifier(companyId, loginName);
      user = resolved.user ? await User.findById(resolved.user._id) : null;
    } else {
      return res.status(400).json({ error: 'Enter your username or email.' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found. Check Company ID and name.' });
    }

    user.password = bcrypt.hashSync(String(newPassword).trim(), 10);
    user.mustChangePassword = false;
    await user.save();

    return res.json({ success: true, message: 'Password updated. You can log in with your new password.' });
  } catch (err) {
    console.error('resetPassword error:', err.message || err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// GET /api/login-invite/:token — public; one-time redeem for SMS login link
async function getLoginInvite(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Invalid login link' });

  try {
    const invite = await redeemLoginInvite(token);
    if (!invite) return res.status(404).json({ error: 'This login link is invalid or has expired.' });

    const user = await User.findOne({
      _id: invite.userId,
      companyId: invite.companyId,
      role: { $in: ['employee', 'manager', 'super-admin'] },
    })
      .select('username passwordDisplayEncrypted mustChangePassword employeeId')
      .lean();
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (user.employeeId) {
      const emp = await Employee.findOne({ _id: user.employeeId, companyId: invite.companyId })
        .select('active')
        .lean();
      if (emp && !emp.active) {
        return res.status(403).json({ error: 'This employee account is inactive.' });
      }
    }

    let password = '';
    if (user.passwordDisplayEncrypted) {
      try {
        password = decrypt(user.passwordDisplayEncrypted) || '';
      } catch (_) {}
    }
    if (!password) {
      return res.status(400).json({ error: 'Login link could not be prepared. Ask your manager to send a new text.' });
    }

    return res.json({
      companyId: invite.companyId,
      username: user.username,
      password,
      must_change_password: !!user.mustChangePassword,
    });
  } catch (err) {
    console.error('getLoginInvite error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  login,
  logout,
  me,
  getProfile,
  updateProfile,
  testEmail,
  getLoginOptions,
  resetPassword,
  getLoginInvite,
};

