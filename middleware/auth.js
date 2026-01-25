function requireAuth(req, res, next) {
  res.setHeader('Content-Type', 'application/json');

  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized - Please log in' });
  }
  return next();
}

async function requireCompany(req, res, next) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.session?.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'Missing companyId in session' });
  }

  req.companyId = companyId;

  // Landlord control: block suspended companies from all API access.
  // Note: if no Company record exists yet, we allow access for backward compatibility.
  try {
    const Company = require('../models/Company');
    const company = await Company.findOne({ slug: companyId }).select('slug status subscriptionEndDate').lean();
    req.company = company || null;

    if (company?.status === 'Suspended') {
      return res
        .status(403)
        .json({ error: "Subscription expired. Please contact Jackie's Time Clock." });
    }

    return next();
  } catch (err) {
    console.error('requireCompany error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function requireManager(req, res, next) {
  if (req.session?.user?.role !== 'manager') {
    return res.status(403).json({ error: 'Manager access required' });
  }
  return next();
}

module.exports = { requireAuth, requireCompany, requireManager };

