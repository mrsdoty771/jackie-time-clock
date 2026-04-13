function apiPathAfterMount(req) {
  const u = (req.originalUrl || req.url || '').split('?')[0];
  const i = u.indexOf('/api');
  const rest = i >= 0 ? u.slice(i + 4) : u;
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** Endpoints allowed while the user must change their password (first login / admin reset). */
function allowWhenMustChangePassword(req) {
  const p = apiPathAfterMount(req);
  const method = req.method.toUpperCase();
  if (method === 'POST' && ['/login', '/logout', '/forgot-password'].includes(p)) return true;
  if (method === 'GET' && ['/me', '/login-options'].includes(p)) return true;
  if (method === 'GET' && p === '/company-settings') return true;
  if ((method === 'GET' || method === 'PUT') && p === '/profile') return true;
  return false;
}

/**
 * Blocks clock-in and other app APIs until the user clears must_change_password (via PUT /profile).
 */
function blockIfMustChangePassword(req, res, next) {
  const user = req.session?.user;
  if (!user || !user.must_change_password) return next();
  if (allowWhenMustChangePassword(req)) return next();
  res.setHeader('Content-Type', 'application/json');
  return res.status(403).json({
    error: 'You must set a new password before continuing.',
    code: 'PASSWORD_RESET_REQUIRED',
  });
}

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
  const role = req.session?.user?.role;
  if (role !== 'manager' && role !== 'super-admin') {
    return res.status(403).json({ error: 'Manager access required' });
  }
  return next();
}

module.exports = { requireAuth, requireCompany, requireManager, blockIfMustChangePassword };

