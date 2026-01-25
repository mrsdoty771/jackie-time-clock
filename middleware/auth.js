function requireAuth(req, res, next) {
  res.setHeader('Content-Type', 'application/json');

  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized - Please log in' });
  }
  return next();
}

function requireCompany(req, res, next) {
  const companyId = req.session?.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'Missing companyId in session' });
  }
  req.companyId = companyId;
  return next();
}

function requireManager(req, res, next) {
  if (req.session?.user?.role !== 'manager') {
    return res.status(403).json({ error: 'Manager access required' });
  }
  return next();
}

module.exports = { requireAuth, requireCompany, requireManager };

