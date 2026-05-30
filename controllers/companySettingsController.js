const CompanySettings = require('../models/CompanySettings');
const Employee = require('../models/Employee');
const { isSystemClockEmployee } = require('../utils/systemEmployee');

function normalizeCompanyId(raw) {
  const v = String(raw || '').trim();
  return v.length ? v : null;
}

// GET /api/company-settings
// Public: pass ?companyId=...
// Authed: derives companyId from session
async function getCompanySettings(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.session?.user?.companyId || normalizeCompanyId(req.query.companyId);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  try {
    const settings = await CompanySettings.findOne({ companyId }).lean();
    if (!settings) {
      return res.json({
        company_name: 'MVC',
        logo_data: null,
        company_admin_employee_id: null,
        timezone: 'UTC',
        pay_week_start_day: 1,
        pay_week_end_day: 0,
      });
    }
    const startDay = Number.isInteger(settings.payWeekStartDay) ? settings.payWeekStartDay : 1;
    const endDay = Number.isInteger(settings.payWeekEndDay) ? settings.payWeekEndDay : 0;
    let companyAdminEmployeeId = settings.companyAdminEmployeeId ? String(settings.companyAdminEmployeeId) : null;
    if (companyAdminEmployeeId) {
      const adminEmp = await Employee.findOne({ _id: companyAdminEmployeeId, companyId })
        .select('employeeNumber')
        .lean();
      if (!adminEmp || isSystemClockEmployee(adminEmp)) {
        companyAdminEmployeeId = null;
      }
    }
    return res.json({
      company_name: settings.companyName || 'MVC',
      logo_data: settings.logoData || null,
      company_admin_employee_id: companyAdminEmployeeId,
      timezone: settings.timezone && String(settings.timezone).trim() ? String(settings.timezone).trim() : 'UTC',
      pay_week_start_day: startDay,
      pay_week_end_day: endDay,
    });
  } catch (err) {
    console.error('getCompanySettings error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// PUT /api/company-settings (manager only)
async function updateCompanySettings(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const {
    company_name,
    logo_data,
    company_admin_employee_id,
    timezone,
    pay_week_start_day,
    pay_week_end_day,
  } = req.body;
  if (!company_name || String(company_name).trim().length === 0) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  try {
    const update = {
      companyName: String(company_name).trim(),
    };

    if (pay_week_start_day !== undefined && pay_week_start_day !== null) {
      const startDay = parseInt(pay_week_start_day, 10);
      if (Number.isNaN(startDay) || startDay < 0 || startDay > 6) {
        return res.status(400).json({ error: 'Pay week start day must be 0 (Sunday) through 6 (Saturday)' });
      }
      let endDay = (startDay + 6) % 7;
      if (pay_week_end_day !== undefined && pay_week_end_day !== null) {
        const parsedEnd = parseInt(pay_week_end_day, 10);
        if (Number.isNaN(parsedEnd) || parsedEnd < 0 || parsedEnd > 6) {
          return res.status(400).json({ error: 'Pay week end day must be 0 (Sunday) through 6 (Saturday)' });
        }
        endDay = parsedEnd;
      }
      if (endDay !== (startDay + 6) % 7) {
        return res.status(400).json({
          error: 'Pay week must be exactly 7 consecutive days (end day must be six days after start day)',
        });
      }
      update.payWeekStartDay = startDay;
      update.payWeekEndDay = endDay;
    }
    if (logo_data !== undefined) {
      update.logoData = logo_data && String(logo_data).trim().length > 0 ? String(logo_data).trim() : null;
    }
    if (company_admin_employee_id !== undefined) {
      const raw = String(company_admin_employee_id || '').trim();
      if (!raw) {
        update.companyAdminEmployeeId = null;
      } else {
        const emp = await Employee.findOne({ _id: raw, companyId }).select({ _id: 1, employeeNumber: 1 }).lean();
        if (!emp) {
          return res.status(400).json({ error: 'Selected company admin employee was not found in this company' });
        }
        if (isSystemClockEmployee(emp)) {
          return res.status(400).json({ error: 'That employee cannot be used as company admin' });
        }
        update.companyAdminEmployeeId = emp._id;
      }
    }
    if (timezone !== undefined) {
      const tz = String(timezone || '').trim();
      update.timezone = tz.length > 0 ? tz : 'UTC';
    }
    const updated = await CompanySettings.findOneAndUpdate(
      { companyId },
      { $set: update },
      { upsert: true, new: true }
    ).lean();

    const uStart = Number.isInteger(updated.payWeekStartDay) ? updated.payWeekStartDay : 1;
    const uEnd = Number.isInteger(updated.payWeekEndDay) ? updated.payWeekEndDay : 0;
    return res.json({
      success: true,
      company_name: updated.companyName,
      logo_data: updated.logoData || null,
      company_admin_employee_id: updated.companyAdminEmployeeId ? String(updated.companyAdminEmployeeId) : null,
      timezone: updated.timezone && String(updated.timezone).trim() ? String(updated.timezone).trim() : 'UTC',
      pay_week_start_day: uStart,
      pay_week_end_day: uEnd,
    });
  } catch (err) {
    console.error('updateCompanySettings error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = { getCompanySettings, updateCompanySettings };

