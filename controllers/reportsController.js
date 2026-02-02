const Punch = require('../models/Punch');
const Employee = require('../models/Employee');
const User = require('../models/User');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { decrypt } = require('../utils/encrypt');

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKeyLocal(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPunchType(type) {
  return String(type || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDateTime(date) {
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Shared: build report data array for weekly and email. */
async function getReportData(companyId, user, startDate, endDate, employeeId) {
  const filter = { companyId };
  if (user.role === 'employee') {
    filter.employeeId = user.employee_id;
  } else if (employeeId) {
    filter.employeeId = employeeId;
  }
  const endInclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  filter.punchTime = { $gte: startDate, $lte: endInclusive };

  const punches = await Punch.find(filter).sort({ employeeId: 1, punchTime: 1 }).lean();
  const employeeIds = Array.from(new Set(punches.map((p) => String(p.employeeId))));
  const employees = await Employee.find({ companyId, _id: { $in: employeeIds } })
    .select('_id name employeeNumber')
    .lean();
  const empMap = new Map(employees.map((e) => [String(e._id), e]));
  const employeeMap = {};

  punches.forEach((p) => {
    const empId = String(p.employeeId);
    const emp = empMap.get(empId);
    const empName = emp?.name || p.employeeName || 'Employee';
    const empNum = emp?.employeeNumber || null;
    const dayKey = dateKeyLocal(p.punchTime);
    if (!employeeMap[empId]) {
      employeeMap[empId] = {
        employee_id: empId,
        employee_name: empName,
        employee_number: empNum,
        days: {},
        total_hours: 0,
      };
    }
    if (!employeeMap[empId].days[dayKey]) {
      employeeMap[empId].days[dayKey] = { date: dayKey, punches: [], hours: 0 };
    }
    employeeMap[empId].days[dayKey].punches.push({
      type: p.punchType,
      time: p.punchTime,
      notes: p.notes || null,
    });
  });

  Object.values(employeeMap).forEach((emp) => {
    Object.values(emp.days).forEach((day) => {
      let clockIn = null;
      let clockOut = null;
      let lunchIn = null;
      let lunchOut = null;
      day.punches.sort((a, b) => new Date(a.time) - new Date(b.time));
      day.punches.forEach((p) => {
        if (p.type === 'clock_in') clockIn = new Date(p.time);
        if (p.type === 'clock_out') clockOut = new Date(p.time);
        if (p.type === 'lunch_in') lunchIn = new Date(p.time);
        if (p.type === 'lunch_out') lunchOut = new Date(p.time);
      });
      let effectiveClockOut = clockOut;
      if (clockIn && !clockOut) {
        const dayEnd = new Date(day.date + 'T23:59:59.999');
        effectiveClockOut = dayEnd > new Date() ? new Date() : dayEnd;
      }
      let hours = 0;
      if (clockIn && effectiveClockOut) {
        hours = (effectiveClockOut - clockIn) / (1000 * 60 * 60);
        if (lunchIn && lunchOut) {
          hours -= (lunchIn - lunchOut) / (1000 * 60 * 60);
        }
        hours = Math.max(0, hours);
      }
      day.hours = parseFloat(hours.toFixed(2));
      emp.total_hours += day.hours;
    });
    emp.total_hours = parseFloat(emp.total_hours.toFixed(2));
  });

  return Object.values(employeeMap);
}

/** Build PDF buffer from report data. */
function buildReportPdf(reportData, startDateStr, endDateStr, employeeLabel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(18).text('Time Clock Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Employee: ${employeeLabel}`, { align: 'center' });
    doc.text(`Date Range: ${startDateStr} - ${endDateStr}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(1);

    reportData.forEach((emp) => {
      doc.fontSize(14).text(`${emp.employee_name} (${emp.employee_number || ''})`);
      doc.fontSize(11).text(`Total Hours: ${emp.total_hours}`);
      doc.moveDown(0.5);
      const dayList = Object.values(emp.days).sort((a, b) => a.date.localeCompare(b.date));
      dayList.forEach((day) => {
        doc.fontSize(10).text(`${formatDate(day.date)} - ${day.hours} hours`);
        day.punches.sort((a, b) => new Date(a.time) - new Date(b.time));
        day.punches.forEach((p) => {
          doc.fontSize(9).text(`  ${formatPunchType(p.type)}: ${formatDateTime(p.time)}${p.notes ? ` (${p.notes})` : ''}`, { indent: 15 });
        });
        doc.moveDown(0.3);
      });
      doc.moveDown(0.5);
    });

    doc.end();
  });
}

// GET /api/reports/weekly?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&employee_id?
async function weekly(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  const user = req.session.user;
  const startDate = parseDateOnly(req.query.start_date);
  const endDate = parseDateOnly(req.query.end_date);
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'start_date must be before or equal to end_date' });
  }
  try {
    const data = await getReportData(companyId, user, startDate, endDate, req.query.employee_id || null);
    return res.json(data);
  } catch (err) {
    console.error('weekly report error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// POST /api/reports/email — send report as PDF attachment (manager only)
async function emailReport(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const { to, start_date, end_date, employee_id } = req.body || {};
  const toEmail = typeof to === 'string' ? to.trim() : '';
  if (!toEmail) {
    return res.status(400).json({ error: 'Recipient email (to) is required' });
  }
  const startDate = parseDateOnly(start_date);
  const endDate = parseDateOnly(end_date);
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'start_date must be before or equal to end_date' });
  }

  const companyId = req.companyId;
  const sessionUser = req.session.user;
  const employeeId = employee_id || null;

  let transporter;
  let fromEmail;
  let fromName = null;

  const dbUser = await User.findOne({ _id: sessionUser.id, companyId }).lean();
  const useManagerSmtp = dbUser && dbUser.smtpHost && dbUser.smtpUser && dbUser.smtpPassEncrypted;
  const smtpPass = useManagerSmtp ? decrypt(dbUser.smtpPassEncrypted) : null;

  if (useManagerSmtp && smtpPass) {
    const port = Number(dbUser.smtpPort) || 587;
    const secure = port === 465; // 587/25 use STARTTLS
    const host = (dbUser.smtpHost || '').toLowerCase();
    transporter = nodemailer.createTransport({
      host: dbUser.smtpHost,
      port,
      secure,
      requireTLS: !secure && (host.includes('office365') || host.includes('gmail') || true),
      auth: { user: dbUser.smtpUser, pass: smtpPass },
    });
    fromEmail = dbUser.smtpUser;
    fromName = (dbUser.displayName || dbUser.name || '').trim() || null;
  } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = port === 465; // 587/25 use STARTTLS
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    fromEmail = (sessionUser && sessionUser.email && String(sessionUser.email).trim()) || process.env.SMTP_FROM || process.env.SMTP_USER || 'timeclock@localhost';
    fromName = (sessionUser && (sessionUser.name || sessionUser.displayName)) || null;
  } else {
    return res.status(503).json({
      error: 'Email is not configured. Either set up E-mail Address Setup in My Account (From email, SMTP server, port, password) and save, or add SMTP_USER and SMTP_PASS to .env. See SMTP_SETUP.md.',
    });
  }

  const fromField = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${fromEmail}>` : fromEmail;
  const user = sessionUser;

  try {
    const reportData = await getReportData(companyId, user, startDate, endDate, employeeId);
    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const employeeLabel = employeeId ? (reportData[0]?.employee_name || 'Employee') : 'All Employees';
    const pdfBuffer = await buildReportPdf(reportData, startStr, endStr, employeeLabel);

    const defaultBody = (dbUser && dbUser.defaultEmailBody) || `Please find the time clock report attached (${startStr} to ${endStr}).`;
    await transporter.sendMail({
      from: fromField,
      to: toEmail,
      subject: `Time Clock Report - ${startStr} to ${endStr}`,
      text: defaultBody,
      attachments: [{ filename: 'time-clock-report.pdf', content: pdfBuffer }],
    });

    return res.json({ success: true, message: 'Report sent by email.' });
  } catch (err) {
    console.error('email report error:', err);
    const errorMessage =
      (err.response && String(err.response).trim()) ||
      (err.message && String(err.message).trim()) ||
      (err.code && `Error code: ${err.code}`) ||
      'Failed to send email';
    return res.status(500).json({ error: errorMessage });
  }
}

module.exports = { weekly, emailReport };

