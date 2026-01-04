const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'time-clock-secret-key-change-in-production',
  resave: true, // Changed to true to help maintain session
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax' // Helps with cookie handling
  },
  name: 'timeclock.sid' // Explicit session name
}));
// Note: express.static is added after API routes to ensure API routes are matched first

// Database initialization
const db = new sqlite3.Database('./timeclock.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Users table (for login)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    employee_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Employees table
  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    employee_number TEXT UNIQUE,
    email TEXT,
    phone TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Time records table
  db.run(`CREATE TABLE IF NOT EXISTS time_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    punch_type TEXT NOT NULL,
    punch_time DATETIME NOT NULL,
    notes TEXT,
    created_by INTEGER,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  // Employee notes table
  db.run(`CREATE TABLE IF NOT EXISTS employee_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    note_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    read_status INTEGER DEFAULT 0,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )`);

  // Create default admin user if it doesn't exist
  db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
    if (!row) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        ['admin', hashedPassword, 'manager']);
      console.log('Default admin user created: username=admin, password=admin123');
    }
  });
}

// Authentication middleware
function requireAuth(req, res, next) {
  // Always set JSON content type for API routes
  res.setHeader('Content-Type', 'application/json');
  
  if (req.session.user) {
    next();
  } else {
    // Ensure we return JSON, not HTML
    console.log('Auth failed - no session user. Session:', req.session);
    return res.status(401).json({ error: 'Unauthorized - Please log in' });
  }
}

function requireManager(req, res, next) {
  if (req.session.user && req.session.user.role === 'manager') {
    next();
  } else {
    res.status(403).json({ error: 'Manager access required' });
  }
}

// Auth routes
app.post('/api/login', (req, res) => {
  const { username, password, employee_id } = req.body;
  
  let query;
  let params;
  
  // Support both username (manager) and employee_id (employee) login
  if (employee_id) {
    query = "SELECT u.*, e.name as employee_name FROM users u JOIN employees e ON u.employee_id = e.id WHERE u.employee_id = ? AND e.active = 1";
    params = [employee_id];
  } else if (username) {
    query = "SELECT * FROM users WHERE username = ?";
    params = [username];
  } else {
    return res.status(400).json({ error: 'Username or employee ID required' });
  }
  
  db.get(query, params, (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Ensure employee_id is set correctly
    let finalEmployeeId = user.employee_id;
    
    // If logging in with employee_id but user.employee_id is null, use the provided employee_id
    if (!finalEmployeeId && employee_id) {
      finalEmployeeId = employee_id;
    }
    
    req.session.user = {
      id: user.id,
      username: user.username || user.employee_name,
      role: user.role,
      employee_id: finalEmployeeId,
      employee_name: user.employee_name || null
    };
    
    console.log('Login successful - session user:', req.session.user);
    
    res.json({ success: true, user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  // Don't require auth here - just return what's in session
  res.setHeader('Content-Type', 'application/json');
  
  if (!req.session.user) {
    return res.json({ user: null });
  }
  
  // Refresh session expiration
  req.session.touch();
  
  // If employee, get their name from employees table
  if (req.session.user.employee_id) {
    db.get("SELECT name FROM employees WHERE id = ?", [req.session.user.employee_id], (err, emp) => {
      if (err || !emp) {
        return res.json({ user: req.session.user });
      }
      const userWithName = {
        ...req.session.user,
        employee_name: emp.name
      };
      res.json({ user: userWithName });
    });
  } else {
    res.json({ user: req.session.user });
  }
});

// Employee routes
// Public endpoint for login dropdown (only returns id, name, employee_number)
app.get('/api/employees/public', (req, res) => {
  db.all("SELECT id, name, employee_number FROM employees WHERE active = 1 ORDER BY name", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.get('/api/employees', requireAuth, (req, res) => {
  const query = req.session.user.role === 'manager' 
    ? "SELECT * FROM employees WHERE active = 1 ORDER BY name"
    : "SELECT id, name, employee_number FROM employees WHERE id = ? AND active = 1";
  
  const params = req.session.user.role === 'manager' ? [] : [req.session.user.employee_id];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/employees', requireManager, (req, res) => {
  const { name, employee_number, email, phone } = req.body;
  
  db.run("INSERT INTO employees (name, employee_number, email, phone) VALUES (?, ?, ?, ?)",
    [name, employee_number, email, phone], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Create user account for employee
      const defaultPassword = bcrypt.hashSync('password123', 10);
      db.run("INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, ?, ?)",
        [employee_number, defaultPassword, 'employee', this.lastID], (err) => {
          if (err) {
            console.error('Error creating user account:', err);
          }
        });
      
      res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/employees/:id', requireManager, (req, res) => {
  const { id } = req.params;
  
  db.run("UPDATE employees SET active = 0 WHERE id = ?", [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true });
  });
});

// Time punch routes
app.post('/api/punch', requireAuth, (req, res) => {
  const { employee_id, punch_type, notes } = req.body;
  const userId = req.session.user.id;
  
  // Employees can only punch themselves, managers can punch anyone
  const targetEmployeeId = req.session.user.role === 'manager' 
    ? employee_id 
    : req.session.user.employee_id;
  
  if (!targetEmployeeId) {
    return res.status(400).json({ error: 'Employee ID required' });
  }
  
  const validTypes = ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'];
  if (!validTypes.includes(punch_type)) {
    return res.status(400).json({ error: 'Invalid punch type' });
  }
  
  db.run("INSERT INTO time_records (employee_id, punch_type, punch_time, notes, created_by) VALUES (?, ?, datetime('now'), ?, ?)",
    [targetEmployeeId, punch_type, notes || null, userId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true, id: this.lastID });
    });
});

app.get('/api/punches', requireAuth, (req, res) => {
  const { employee_id, start_date, end_date } = req.query;
  
  let query = `
    SELECT tr.*, e.name as employee_name, e.employee_number
    FROM time_records tr
    JOIN employees e ON tr.employee_id = e.id
    WHERE 1=1
  `;
  const params = [];
  
  // Employees can only see their own records
  if (req.session.user.role === 'employee') {
    query += " AND tr.employee_id = ?";
    params.push(req.session.user.employee_id);
  } else if (employee_id) {
    query += " AND tr.employee_id = ?";
    params.push(employee_id);
  }
  
  if (start_date) {
    query += " AND date(tr.punch_time) >= ?";
    params.push(start_date);
  }
  
  if (end_date) {
    query += " AND date(tr.punch_time) <= ?";
    params.push(end_date);
  }
  
  query += " ORDER BY tr.punch_time DESC LIMIT 500";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Reports route
app.get('/api/reports/weekly', requireAuth, (req, res) => {
  const { employee_id, week_start } = req.query;
  
  // Calculate week start (Monday) if not provided
  let startDate = week_start;
  if (!startDate) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    const monday = new Date(today.setDate(diff));
    startDate = monday.toISOString().split('T')[0];
  }
  
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const endDateStr = endDate.toISOString().split('T')[0];
  
  let query = `
    SELECT 
      e.id as employee_id,
      e.name as employee_name,
      e.employee_number,
      date(tr.punch_time) as date,
      tr.punch_type,
      tr.punch_time,
      tr.notes
    FROM time_records tr
    JOIN employees e ON tr.employee_id = e.id
    WHERE date(tr.punch_time) >= ? AND date(tr.punch_time) <= ?
  `;
  const params = [startDate, endDateStr];
  
  if (req.session.user.role === 'employee') {
    query += " AND e.id = ?";
    params.push(req.session.user.employee_id);
  } else if (employee_id) {
    query += " AND e.id = ?";
    params.push(employee_id);
  }
  
  query += " ORDER BY e.name, tr.punch_time";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Process records to calculate hours
    const report = calculateWeeklyHours(rows);
    res.json(report);
  });
});

function calculateWeeklyHours(records) {
  const employeeMap = {};
  
  records.forEach(record => {
    const key = record.employee_id;
    if (!employeeMap[key]) {
      employeeMap[key] = {
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        employee_number: record.employee_number,
        days: {},
        total_hours: 0
      };
    }
    
    const date = record.date;
    if (!employeeMap[key].days[date]) {
      employeeMap[key].days[date] = {
        date: date,
        punches: [],
        hours: 0
      };
    }
    
    employeeMap[key].days[date].punches.push({
      type: record.punch_type,
      time: record.punch_time,
      notes: record.notes
    });
  });
  
  // Calculate hours for each day
  Object.values(employeeMap).forEach(emp => {
    Object.values(emp.days).forEach(day => {
      let clockIn = null;
      let clockOut = null;
      let lunchIn = null;
      let lunchOut = null;
      
      day.punches.sort((a, b) => new Date(a.time) - new Date(b.time));
      
      day.punches.forEach(punch => {
        if (punch.type === 'clock_in') clockIn = new Date(punch.time);
        if (punch.type === 'clock_out') clockOut = new Date(punch.time);
        if (punch.type === 'lunch_in') lunchIn = new Date(punch.time);
        if (punch.type === 'lunch_out') lunchOut = new Date(punch.time);
      });
      
      let hours = 0;
      if (clockIn && clockOut) {
        hours = (clockOut - clockIn) / (1000 * 60 * 60); // Convert to hours
        
        // Subtract lunch time if applicable
        if (lunchIn && lunchOut) {
          const lunchHours = (lunchOut - lunchIn) / (1000 * 60 * 60);
          hours -= lunchHours;
        }
        
        hours = Math.max(0, hours); // Ensure non-negative
      }
      
      day.hours = parseFloat(hours.toFixed(2));
      emp.total_hours += day.hours;
    });
    
    emp.total_hours = parseFloat(emp.total_hours.toFixed(2));
  });
  
  return Object.values(employeeMap);
}

// Employee Notes routes
app.post('/api/notes', requireAuth, (req, res) => {
  // Ensure we always return JSON
  res.setHeader('Content-Type', 'application/json');
  
  // Check session exists before accessing
  if (!req.session || !req.session.user) {
    console.error('Note submission: Session missing after requireAuth');
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  
  // Refresh session expiration
  req.session.touch();
  
  const { note_text } = req.body;
  const employee_id = req.session.user.employee_id;
  
  // Debug logging
  console.log('Note submission - employee_id:', employee_id);
  console.log('Note submission - session user:', req.session.user);
  console.log('Note submission - note_text:', note_text);
  
  if (!employee_id) {
    console.error('Note submission failed: No employee_id in session');
    return res.status(400).json({ error: 'Employee ID required. Please log out and log back in.' });
  }
  
  if (!note_text || note_text.trim().length === 0) {
    return res.status(400).json({ error: 'Note text is required' });
  }
  
  // First, find the employee's most recent time record
  db.get("SELECT id, notes FROM time_records WHERE employee_id = ? ORDER BY punch_time DESC LIMIT 1",
    [employee_id], (err, lastRecord) => {
      if (err) {
        console.error('Database error finding last record:', err);
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }
      
      // Update the last time record with the note
      if (lastRecord) {
        const existingNotes = lastRecord.notes ? lastRecord.notes + '\n' : '';
        const updatedNotes = existingNotes + note_text.trim();
        
        db.run("UPDATE time_records SET notes = ? WHERE id = ?",
          [updatedNotes, lastRecord.id], function(updateErr) {
            if (updateErr) {
              console.error('Database error updating time record:', updateErr);
              return res.status(500).json({ error: 'Database error: ' + updateErr.message });
            }
            
            // Also save to employee_notes table for manager viewing
            db.run("INSERT INTO employee_notes (employee_id, note_text) VALUES (?, ?)",
              [employee_id, note_text.trim()], function(insertErr) {
                if (insertErr) {
                  console.error('Database error inserting note:', insertErr);
                  // Don't fail the request if this fails, the time record was updated
                }
                res.json({ success: true, time_record_id: lastRecord.id, note_added: true });
              });
          });
      } else {
        // No time records yet, just save to employee_notes
        db.run("INSERT INTO employee_notes (employee_id, note_text) VALUES (?, ?)",
          [employee_id, note_text.trim()], function(insertErr) {
            if (insertErr) {
              console.error('Database error inserting note:', insertErr);
              return res.status(500).json({ error: 'Database error: ' + insertErr.message });
            }
            res.json({ success: true, id: this.lastID, note_added: true, message: 'Note saved. No time records found to attach it to.' });
          });
      }
    });
});

app.get('/api/notes', requireAuth, (req, res) => {
  // Ensure we always return JSON
  res.setHeader('Content-Type', 'application/json');
  
  // Check session exists
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  
  if (req.session.user.role === 'manager') {
    // Managers can see all notes
    const query = `
      SELECT en.*, e.name as employee_name, e.employee_number
      FROM employee_notes en
      JOIN employees e ON en.employee_id = e.id
      ORDER BY en.created_at DESC
      LIMIT 100
    `;
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Error loading notes:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    });
  } else {
    // Employees can only see their own notes
    const employee_id = req.session.user.employee_id;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID not found in session' });
    }
    db.all("SELECT * FROM employee_notes WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50",
      [employee_id], (err, rows) => {
        if (err) {
          console.error('Error loading employee notes:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
      });
  }
});

app.put('/api/notes/:id/read', requireManager, (req, res) => {
  const { id } = req.params;
  db.run("UPDATE employee_notes SET read_status = 1 WHERE id = ?", [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true });
  });
});

// Serve static files AFTER API routes (so API routes are matched first)
app.use(express.static('public'));

// Serve main page (must be last, after all API routes)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware - must be after all routes
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (req.path.startsWith('/api/')) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  } else {
    next(err);
  }
});

// Catch-all for undefined API routes - return 404 JSON
// This must be AFTER all API routes
app.use('/api/*', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  console.log('404 - API route not found:', req.method, req.path);
  res.status(404).json({ error: 'API endpoint not found: ' + req.method + ' ' + req.path });
});

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('='.repeat(60));
  console.log(`Time Clock server is running!`);
  console.log(`Local access:    http://localhost:${PORT}`);
  console.log(`Network access:  http://${localIP}:${PORT}`);
  console.log('='.repeat(60));
  console.log('\nTo access from the internet:');
  console.log('1. Configure your router to forward port', PORT, 'to this computer');
  console.log('2. Find your public IP at https://whatismyipaddress.com/');
  console.log('3. Access via: http://YOUR_PUBLIC_IP:' + PORT);
  console.log('\n⚠️  Security Note: Change default passwords before exposing to internet!');
  console.log('='.repeat(60));
});

