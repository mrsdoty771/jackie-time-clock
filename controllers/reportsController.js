const Punch = require('../models/Punch');
const Employee = require('../models/Employee');
const User = require('../models/User');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { decrypt } = require('../utils/encrypt');
const {
  getCompanyTimezone,
  getUtcRangeForLocalDate,
  getLocalDateStringInTz,
  formatDateTimeInTz,
  formatLocalDateInTz,
  enumerateLocalDatesInRange,
} = require('../utils/timezone');
const { calculateDayWorkHours } = require('../utils/workHours');

function formatPunchType(type) {
  return String(type || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Shared: build report data array for weekly and email. startDateStr/endDateStr are YYYY-MM-DD in company TZ. */
async function getReportData(companyId, user, startDateStr, endDateStr, employeeId, timezone) {
  const tz = timezone || 'UTC';
  const { startUtc } = getUtcRangeForLocalDate(startDateStr, tz);
  const { endUtc } = getUtcRangeForLocalDate(endDateStr, tz);

  const filter = { companyId, punchTime: { $gte: startUtc, $lte: endUtc } };
  if (user.role === 'employee') {
    filter.employeeId = user.employee_id;
  } else if (employeeId) {
    filter.employeeId = employeeId;
  }

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
    const dayKey = getLocalDateStringInTz(p.punchTime, tz);
    if (dayKey < startDateStr || dayKey > endDateStr) return;
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
      approval_status: p.approvalStatus || 'none',
    });
  });

  const allDatesInRange = enumerateLocalDatesInRange(startDateStr, endDateStr, tz);
  Object.values(employeeMap).forEach((emp) => {
    allDatesInRange.forEach((dateStr) => {
      if (!emp.days[dateStr]) {
        emp.days[dateStr] = { date: dateStr, punches: [], hours: 0 };
      }
    });
    emp.total_hours = 0;
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
      let asOf = new Date();
      if (clockIn && !clockOut) {
        const { endUtc: dayEndUtc } = getUtcRangeForLocalDate(day.date, tz);
        asOf = dayEndUtc > asOf ? asOf : dayEndUtc;
      }
      const hours = calculateDayWorkHours({ clockIn, clockOut, lunchIn, lunchOut, asOf });
      day.hours = parseFloat(hours.toFixed(2));
      emp.total_hours += day.hours;
    });
    emp.total_hours = parseFloat(emp.total_hours.toFixed(2));
  });

  return Object.values(employeeMap);
}

function formatShortDateStr(dateStr) {
  const s = String(dateStr || '').trim().slice(0, 10);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

function formatTimeOnlyInTz(time, tz) {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: tz || 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatHoursAsHMM(hours) {
  const h = Number(hours) || 0;
  let wholeHours = Math.floor(h);
  let minutes = Math.round((h - wholeHours) * 60);
  if (minutes === 60) {
    wholeHours += 1;
    minutes = 0;
  }
  return `${wholeHours}:${String(minutes).padStart(2, '0')}`;
}

function getDayPunchTimeTz(day, type, tz) {
  const punches = [...(day.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  const match = punches.find((p) => p.type === type);
  return match ? formatTimeOnlyInTz(match.time, tz) : '';
}

/** Build PDF buffer from report data. timezone used for formatting punch times. */
function buildReportPdf(reportData, startDateStr, endDateStr, employeeLabel, timezone) {
  const tz = timezone || 'UTC';
  const colX = [50, 105, 148, 191, 234, 277, 328];
  const colW = [52, 40, 40, 40, 40, 48, 217];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(18).text('Time Sheet', 50, 50);
    doc.fontSize(10).text(`Start Date  ${formatShortDateStr(startDateStr)}`, 350, 55, { align: 'right', width: 200 });
    doc.text(`End Date  ${formatShortDateStr(endDateStr)}`, 350, 68, { align: 'right', width: 200 });
    doc.y = 100;

    reportData.forEach((emp) => {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(12).fillColor('#000').text(emp.employee_name, 50, doc.y);
      doc.moveDown(0.4);

      const headers = ['Work Date', 'Time In', 'Lunch Out', 'Lunch In', 'Time Out', 'Total Hrs'];
      doc.fontSize(8).fillColor('#000');
      const headerY = doc.y;
      headers.forEach((h, i) => {
        doc.text(h, colX[i], headerY, { width: colW[i], align: i === 5 ? 'right' : 'left' });
      });
      doc.moveDown(0.6);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
      doc.moveDown(0.3);

      const dayList = Object.values(emp.days)
        .filter((day) => day.punches && day.punches.length > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      dayList.forEach((day) => {
        if (doc.y > 700) doc.addPage();
        const rowY = doc.y;
        const cells = [
          formatShortDateStr(day.date),
          getDayPunchTimeTz(day, 'clock_in', tz),
          getDayPunchTimeTz(day, 'lunch_out', tz),
          getDayPunchTimeTz(day, 'lunch_in', tz),
          getDayPunchTimeTz(day, 'clock_out', tz),
          formatHoursAsHMM(day.hours),
        ];
        cells.forEach((text, i) => {
          doc.fontSize(9).fillColor('#000').text(text, colX[i], rowY, { width: colW[i], align: i === 5 ? 'right' : 'left' });
        });
        const notes = (day.punches || []).filter((p) => p.notes).map((p) => p.notes).join('; ');
        if (notes) {
          doc.fontSize(8).fillColor('#444').text(notes, colX[6], rowY, { width: colW[6] });
        }
        doc.moveDown(0.9);
      });

      doc.moveDown(0.2);
      doc.fontSize(11).fillColor('#cc0000').text(formatHoursAsHMM(emp.total_hours), colX[5], doc.y, { width: colW[5], align: 'right' });
      doc.fillColor('#000');
      doc.moveDown(1.2);
    });

    doc.end();
  });
}

// GET /api/reports/weekly?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&employee_id?
// start_date and end_date are interpreted in company timezone.
async function weekly(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const companyId = req.companyId;
  const user = req.session.user;
  const startDateStr = String(req.query.start_date || '').trim().slice(0, 10);
  const endDateStr = String(req.query.end_date || '').trim().slice(0, 10);
  if (!startDateStr || !endDateStr) {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  if (startDateStr > endDateStr) {
    return res.status(400).json({ error: 'start_date must be before or equal to end_date' });
  }
  try {
    const tz = await getCompanyTimezone(companyId);
    const data = await getReportData(companyId, user, startDateStr, endDateStr, req.query.employee_id || null, tz);
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
  const startDateStr = String(start_date || '').trim().slice(0, 10);
  const endDateStr = String(end_date || '').trim().slice(0, 10);
  if (!startDateStr || !endDateStr) {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }
  if (startDateStr > endDateStr) {
    return res.status(400).json({ error: 'start_date must be before or equal to end_date' });
  }

  const companyId = req.companyId;
  const sessionUser = req.session.user;
  const employeeId = employee_id || null;
  const tz = await getCompanyTimezone(companyId);

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
    const reportData = await getReportData(companyId, user, startDateStr, endDateStr, employeeId, tz);
    const startStr = formatLocalDateInTz(startDateStr, tz);
    const endStr = formatLocalDateInTz(endDateStr, tz);
    const employeeLabel = employeeId ? (reportData[0]?.employee_name || 'Employee') : 'All Employees';
    const pdfBuffer = await buildReportPdf(reportData, startStr, endStr, employeeLabel, tz);

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

