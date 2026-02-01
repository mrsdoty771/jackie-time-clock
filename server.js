// 1. Load environment variables first
require('dotenv').config();

// 2. Import core libraries
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

// 3. Initialize the app
const app = express();
const PORT = process.env.PORT || 3000;

// 4. Import Routes & Models
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const punchRoutes = require('./routes/punchRoutes');
const companySettingsRoutes = require('./routes/companySettingsRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
// (Note: You imported User/CompanySettings but didn't use them in this file. 
//  I kept them here in case you need them later, otherwise they can be removed.)
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const CompanySettings = require('./models/CompanySettings');

// 5. Middleware Setup
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

// 6. Connect Routes
app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', punchRoutes);
app.use('/api', companySettingsRoutes);
app.use('/api', reportsRoutes);

// 7. Serve Static Files (Frontend)
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Start Server & Database
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Time Clock server running on port ${PORT}`);
  
  // Connect to MongoDB after the server is already "awake"
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. DB connection skipped.');
    return;
  }

  mongoose.connect(url, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
      console.log('Connected to MongoDB');
      // Ensure default manager users exist if env vars are set
      const companyId = String(process.env.DEFAULT_COMPANY_ID || '').trim();
      const adminUsername = String(process.env.DEFAULT_ADMIN_USERNAME || '').trim();
      const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
      if (companyId && adminUsername && adminPassword) {
        const existingAdmin = await User.findOne({ companyId, username: adminUsername, role: 'manager' }).lean();
        if (!existingAdmin) {
          await User.create({
            companyId,
            username: adminUsername,
            password: bcrypt.hashSync(adminPassword, 10),
            role: 'manager',
          });
          console.log(`Default manager user "${adminUsername}" created for company ${companyId}.`);
        }
      }
      const joshUsername = String(process.env.DEFAULT_MANAGER_2_USERNAME || '').trim();
      const joshPassword = String(process.env.DEFAULT_MANAGER_2_PASSWORD || '').trim();
      if (companyId && joshUsername && joshPassword) {
        const existingJosh = await User.findOne({ companyId, username: joshUsername, role: 'manager' }).lean();
        if (!existingJosh) {
          await User.create({
            companyId,
            username: joshUsername,
            password: bcrypt.hashSync(joshPassword, 10),
            role: 'manager',
          });
          console.log(`Default manager user "${joshUsername}" created for company ${companyId}.`);
        }
      }
    })
    .catch(err => console.error('MongoDB connection error:', err));
});