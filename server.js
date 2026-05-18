// 1. Load environment variables first (from project root, same folder as server.js)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 2. Import core libraries
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
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
const { blockIfMustChangePassword } = require('./middleware/auth');
const CompanySettings = require('./models/CompanySettings');
const Punch = require('./models/Punch');

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

app.use('/api', blockIfMustChangePassword);

// 6. Connect Routes
app.use('/api', authRoutes);
app.use('/api', employeeRoutes);
app.use('/api', punchRoutes);
app.use('/api', companySettingsRoutes);
app.use('/api', reportsRoutes);

// Any unmatched /api/* returns JSON 404 (never HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

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
    // #region agent log
    fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'server.js:db-connect',message:'DATABASE_URL missing',data:{hasUrl:false},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return;
  }

  // #region agent log
  fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'server.js:db-connect',message:'mongoose.connect starting',data:{hasUrl:true,urlLength:String(url).length},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  mongoose.connect(url, { serverSelectionTimeoutMS: 10000 })
    .then(async () => {
      console.log('Connected to MongoDB');
      // #region agent log
      fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'server.js:db-connect',message:'mongoose connected',data:{readyState:mongoose.connection.readyState},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      try {
        // Ensure punch indexes (including duplicate-prevention index) are created.
        await Punch.createIndexes();
      } catch (idxErr) {
        console.error('Punch index creation warning:', idxErr?.message || idxErr);
      }

      /**
       * Bootstrap super admin: username `admin` in `superCo`, password `123abc` (hashed), mustChangePassword true, role super-admin.
       * On every server start: upserts that user and always resets password + mustChangePassword (same hash each boot until you change password in-app — next restart resets again by design).
       * Company id: SUPER_ADMIN_COMPANY_ID, else DEFAULT_COMPANY_ID, else "MVC" (must match app login company).
       */
      async function ensureSuperAdmin() {
        const superCo = String(process.env.SUPER_ADMIN_COMPANY_ID || process.env.DEFAULT_COMPANY_ID || 'MVC').trim();
        const passwordHash = bcrypt.hashSync('123abc', 10);
        await User.findOneAndUpdate(
          { companyId: superCo, username: 'admin' },
          {
            $set: {
              password: passwordHash,
              mustChangePassword: true,
              role: 'super-admin',
            },
            $setOnInsert: {
              companyId: superCo,
              username: 'admin',
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(
          `[ensureSuperAdmin] Ensured super admin: company="${superCo}" username="admin" password reset to "123abc" (mustChangePassword=true).`
        );
      }

      await ensureSuperAdmin();

      // Ensure default manager users exist if env vars are set (skip if username already taken by any role)
      const companyId = String(process.env.DEFAULT_COMPANY_ID || '').trim();
      const forceRecreate = process.env.FORCE_RECREATE_MANAGERS === 'true';
      const adminUsername = String(process.env.DEFAULT_ADMIN_USERNAME || '').trim();
      const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
      if (companyId && adminUsername && adminPassword) {
        if (forceRecreate) {
          await User.deleteMany({ companyId, username: adminUsername, role: 'manager' });
          console.log(`Deleted existing "${adminUsername}" (force recreate).`);
        }
        const existingAdmin = await User.findOne({ companyId, username: adminUsername }).lean();
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
        if (forceRecreate) {
          await User.deleteMany({ companyId, username: joshUsername, role: 'manager' });
          console.log(`Deleted existing "${joshUsername}" (force recreate).`);
        }
        const existingJosh = await User.findOne({ companyId, username: joshUsername }).lean();
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
    .catch(err => {
      console.error('MongoDB connection error:', err);
      // #region agent log
      fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9170a'},body:JSON.stringify({sessionId:'d9170a',location:'server.js:db-connect',message:'mongoose connect failed',data:{errName:err?.name,errMsg:String(err?.message||err).slice(0,200)},timestamp:Date.now(),hypothesisId:'B,E'})}).catch(()=>{});
      // #endregion
    });
});