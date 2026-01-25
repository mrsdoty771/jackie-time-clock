const CompanySettings = require('../models/CompanySettings');

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
    if (!settings) return res.json({ company_name: 'MVC' });
    return res.json({ company_name: settings.companyName || 'MVC' });
  } catch (err) {
    console.error('getCompanySettings error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

// PUT /api/company-settings (manager only)
async function updateCompanySettings(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const { company_name } = req.body;
  if (!company_name || String(company_name).trim().length === 0) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  try {
    const updated = await CompanySettings.findOneAndUpdate(
      { companyId },
      { $set: { companyName: String(company_name).trim() } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ success: true, company_name: updated.companyName });
  } catch (err) {
    console.error('updateCompanySettings error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = { getCompanySettings, updateCompanySettings };

