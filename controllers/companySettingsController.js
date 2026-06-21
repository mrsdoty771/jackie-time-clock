const CompanySettings = require('../models/CompanySettings');
const Employee = require('../models/Employee');
const { encrypt } = require('../utils/encrypt');
const { isSystemClockEmployee } = require('../utils/systemEmployee');
const { isValidIanaTimezone } = require('../utils/timezone');

function normalizeCompanyId(raw) {
  const v = String(raw || '').trim();
  return v.length ? v : null;
}

function isManagerSession(req) {
  const role = req.session?.user?.role;
  return role === 'manager' || role === 'super-admin';
}

function trimUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function twilioFieldsForResponse(settings) {
  if (!settings) {
    return {
      twilio_account_sid: '',
      twilio_phone_number: '',
      twilio_notify_phone: '',
      twilio_auth_token_configured: false,
      twilio_sms_configured: false,
      public_base_url: '',
    };
  }
  const sid = settings.twilioAccountSid ? String(settings.twilioAccountSid).trim() : '';
  const from = settings.twilioPhoneNumber ? String(settings.twilioPhoneNumber).trim() : '';
  const tokenConfigured = !!settings.twilioAuthTokenEncrypted;
  const coreConfigured = !!(sid && tokenConfigured && from);
  return {
    twilio_account_sid: sid,
    twilio_phone_number: from,
    twilio_notify_phone: settings.twilioNotifyPhone ? String(settings.twilioNotifyPhone).trim() : '',
    twilio_auth_token_configured: tokenConfigured,
    twilio_sms_configured: coreConfigured,
    public_base_url: settings.publicBaseUrl ? trimUrl(settings.publicBaseUrl) : '',
  };
}

function baseSettingsResponse(settings) {
  const startDay = Number.isInteger(settings?.payWeekStartDay) ? settings.payWeekStartDay : 1;
  const endDay = Number.isInteger(settings?.payWeekEndDay) ? settings.payWeekEndDay : 0;
  return {
    company_name: settings?.companyName || 'MVC',
    logo_data: settings?.logoData || null,
    company_admin_employee_id: null,
    timezone: settings?.timezone && String(settings.timezone).trim() ? String(settings.timezone).trim() : 'UTC',
    pay_week_start_day: startDay,
    pay_week_end_day: endDay,
  };
}

// GET /api/company-settings
// Public: pass ?companyId=... (branding only)
// Authed manager: Twilio / public URL fields for same company
async function getCompanySettings(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const sessionCompanyId = req.session?.user?.companyId;
  const companyId = sessionCompanyId || normalizeCompanyId(req.query.companyId);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const includeTwilio =
    isManagerSession(req) && sessionCompanyId && String(sessionCompanyId) === String(companyId);

  try {
    const settings = await CompanySettings.findOne({ companyId }).lean();
    if (!settings) {
      const empty = baseSettingsResponse(null);
      if (includeTwilio) Object.assign(empty, twilioFieldsForResponse(null));
      return res.json(empty);
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
    const payload = {
      company_name: settings.companyName || 'MVC',
      logo_data: settings.logoData || null,
      company_admin_employee_id: companyAdminEmployeeId,
      timezone: settings.timezone && String(settings.timezone).trim() ? String(settings.timezone).trim() : 'UTC',
      pay_week_start_day: startDay,
      pay_week_end_day: endDay,
    };
    if (includeTwilio) {
      Object.assign(payload, twilioFieldsForResponse(settings));
    }
    return res.json(payload);
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
    twilio_account_sid,
    twilio_auth_token,
    twilio_phone_number,
    twilio_notify_phone,
    public_base_url,
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
      if (tz.length > 0 && !isValidIanaTimezone(tz)) {
        return res.status(400).json({ error: 'Invalid timezone. Choose a value from the list.' });
      }
      update.timezone = tz.length > 0 ? tz : 'UTC';
    }
    if (twilio_account_sid !== undefined) {
      const sid = String(twilio_account_sid || '').trim();
      update.twilioAccountSid = sid.length > 0 ? sid : null;
    }
    if (twilio_phone_number !== undefined) {
      const from = String(twilio_phone_number || '').trim();
      update.twilioPhoneNumber = from.length > 0 ? from : null;
    }
    if (twilio_notify_phone !== undefined) {
      const notify = String(twilio_notify_phone || '').trim();
      update.twilioNotifyPhone = notify.length > 0 ? notify : null;
    }
    if (twilio_auth_token !== undefined && String(twilio_auth_token).trim()) {
      update.twilioAuthTokenEncrypted = encrypt(String(twilio_auth_token).trim());
    }
    if (public_base_url !== undefined) {
      const url = trimUrl(public_base_url);
      update.publicBaseUrl = url.length > 0 ? url : null;
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
      ...twilioFieldsForResponse(updated),
    });
  } catch (err) {
    console.error('updateCompanySettings error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = { getCompanySettings, updateCompanySettings };
