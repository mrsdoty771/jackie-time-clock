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

// Middleware
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-for-build-phase';

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

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server FIRST, then connect DB (Prevents Health Check timeouts)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Time Clock server running on port ${PORT}`);
  
  // Connect to MongoDB after the server is already "awake"
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. DB connection skipped.');
    return;
  }

  mongoose.connect(url, { serverSelectionTimeoutMS: 10000 })
    .then(() => {
      console.log('Connected to MongoDB');
      // Optional Seed logic
      const companyId = String(process.env.DEFAULT_COMPANY_ID || '').trim();
      if (companyId) {
         console.log('Running optional seed check...');
      }
    })
    .catch(err => console.error('MongoDB connection error:', err));
});