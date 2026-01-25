const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const punchRoutes = require('./routes/punchRoutes');
const companySettingsRoutes = require('./routes/companySettingsRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const User = require('./models/User');
const CompanySettings = require('./models/CompanySettings');

async function connectMongo() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  await mongoose.connect(url, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');
}

async function seedDefaultCompanyAndAdmin() {
  const companyId = String(process.env.DEFAULT_COMPANY_ID || '').trim();
  const adminUsername = String(process.env.DEFAULT_ADMIN_USERNAME || '').trim();
  const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
  const companyName = String(process.env.DEFAULT_COMPANY_NAME || '').trim();

  // Seed is optional: only runs if all required env vars exist.
  if (!companyId || !adminUsername || !adminPassword) return;

  const existingAdmin = await User.findOne({ companyId, username: adminUsername, role: 'manager' }).lean();
  if (!existingAdmin) {
    await User.create({
      companyId,
      username: adminUsername,
      role: 'manager',
      password: bcrypt.hashSync(adminPassword, 10),
    });
    console.log(`Seeded default manager user for companyId=${companyId}`);
  }

  if (companyName) {
    await CompanySettings.findOneAndUpdate(
      { companyId },
      { $setOnInsert: { companyName } },
      { upsert: true, new: false }
    ).lean();
  }
}

// Middleware
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET is not set');
  process.exit(1);
}
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
    name: 'timeclock.sid',
  })
);

// Routes
app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', punchRoutes);
app.use('/api', companySettingsRoutes);
app.use('/api', reportsRoutes);

// Static files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for any non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
  return next(err);
});

connectMongo()
  .then(() => {
    return seedDefaultCompanyAndAdmin();
  })
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Time Clock server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });