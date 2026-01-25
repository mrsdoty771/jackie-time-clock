/**
 * MVC Time Clock (localStorage version)
 * - No server/API required for app state
 * - Employees + punches are stored in localStorage
 * - Uses `.hidden` class for page routing
 */

// -----------------------------
// Storage
// -----------------------------
const STORAGE_KEYS = {
  employees: 'timeclock.employees',
  punches: 'timeclock.punches',
  companyName: 'timeclock.companyName',
};

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadArray(key) {
  const v = safeJsonParse(localStorage.getItem(key), []);
  return Array.isArray(v) ? v : [];
}

function saveArray(key, arr) {
  localStorage.setItem(key, JSON.stringify(Array.isArray(arr) ? arr : []));
}

function loadString(key, fallback = '') {
  const v = localStorage.getItem(key);
  return typeof v === 'string' && v.length ? v : fallback;
}

function saveString(key, value) {
  localStorage.setItem(key, String(value ?? ''));
}

// -----------------------------
// State
// -----------------------------
let currentUser = null;

function getEmployees() {
  return loadArray(STORAGE_KEYS.employees);
}

function setEmployees(employees) {
  saveArray(STORAGE_KEYS.employees, employees);
}

function getPunches() {
  return loadArray(STORAGE_KEYS.punches);
}

function setPunches(punches) {
  saveArray(STORAGE_KEYS.punches, punches);
}

function ensureDefaults() {
  const employees = getEmployees();

  // Default Admin user if storage is empty (as requested)
  if (!employees || employees.length === 0) {
    setEmployees([
      { id: 'admin', name: 'Admin (Manager)', role: 'admin', password: 'admin', active: true },
    ]);
  } else {
    // Ensure at least one admin exists (safety)
    const hasAdmin = employees.some((e) => e && e.id === 'admin');
    if (!hasAdmin) {
      employees.unshift({ id: 'admin', name: 'Admin (Manager)', role: 'admin', password: 'admin', active: true });
      setEmployees(employees);
    }
  }

  // Company name default
  const companyName = loadString(STORAGE_KEYS.companyName, 'MVC');
  if (!companyName) saveString(STORAGE_KEYS.companyName, 'MVC');

  // Punches default
  if (!Array.isArray(getPunches())) setPunches([]);
}

// -----------------------------
// Utilities
// -----------------------------
function $(id) {
  return document.getElementById(id);
}

function getFirstName(fullName) {
  if (!fullName) return 'Employee';
  const parts = String(fullName).trim().split(/\s+/);
  return parts[0] || 'Employee';
}

function localDateString(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatPunchType(type) {
  return String(type)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function showMessage(message, type = 'success') {
  const messageDiv = $('message');
  if (!messageDiv) return;
  messageDiv.textContent = message;
  messageDiv.className = `message ${type}`;
  messageDiv.classList.remove('hidden');
  setTimeout(() => messageDiv.classList.add('hidden'), 5000);
}

// -----------------------------
// Branding
// -----------------------------
function applyCompanyName() {
  const companyName = loadString(STORAGE_KEYS.companyName, 'MVC') || 'MVC';
  const title = `${companyName} Time Clock`;
  document.title = title;
  const loginH1 = document.querySelector('#login-page h1');
  if (loginH1) loginH1.textContent = title;
}

// -----------------------------
// Routing (pages)
// -----------------------------
function showOnlyPage(pageId) {
  ['login-page', 'employee-page', 'manager-page'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (id === pageId) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

function routeAfterLogin() {
  if (!currentUser) return showOnlyPage('login-page');
  if (currentUser.role === 'admin') return showManagerPage();
  return showEmployeePage();
}

function showManagerPage() {
  showOnlyPage('manager-page');
  switchTab('employees');
  refreshManagerUI();
}

function showEmployeePage() {
  showOnlyPage('employee-page');
  const name = currentUser?.name || 'Employee';
  const display = $('employee-name');
  if (display) display.textContent = `Hello ${getFirstName(name)}`;
  renderEmployeeRecords();
  updatePunchButtonStates();
}

// -----------------------------
// Login dropdown (required)
// -----------------------------
function updateUserDropdown() {
  const select = $('user-select');
  if (!select) return;

  // Clear and rebuild every time (required)
  select.innerHTML = '';
  select.appendChild(new Option('-- Select Name --', ''));

  const employees = getEmployees()
    .filter((e) => e && e.id && e.name)
    // only show active users by default
    .filter((e) => e.id === 'admin' || e.active !== false);

  employees
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((e) => {
      select.appendChild(new Option(e.name, e.id));
    });
}

// Backwards compatibility if something still calls populateUserDropdown()
function populateUserDropdown() {
  updateUserDropdown();
}

// -----------------------------
// Auth
// -----------------------------
function handleLoginSubmit(e) {
  e.preventDefault();
  const userId = $('user-select')?.value;
  const password = $('password')?.value ?? '';
  const errorDiv = $('login-error');
  if (errorDiv) errorDiv.textContent = '';

  if (!userId) {
    if (errorDiv) errorDiv.textContent = 'Please select a name';
    return;
  }

  const employees = getEmployees();
  const user = employees.find((u) => u && u.id === userId);
  if (!user) {
    if (errorDiv) errorDiv.textContent = 'User not found. Please refresh.';
    return;
  }

  if (user.active === false) {
    if (errorDiv) errorDiv.textContent = 'This employee is inactive.';
    return;
  }

  if (String(user.password ?? '') !== String(password)) {
    if (errorDiv) errorDiv.textContent = 'Invalid password';
    return;
  }

  currentUser = user;
  $('login-form')?.reset();
  routeAfterLogin();
}

function handleLogout() {
  currentUser = null;
  showOnlyPage('login-page');
  updateUserDropdown();
}

// -----------------------------
// Manager Tabs
// -----------------------------
function switchTab(tabName) {
  // buttons
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // content
  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.remove('active');
  });
  const tabEl = $(`${tabName}-tab`);
  if (tabEl) tabEl.classList.add('active');

  // tab-specific refresh
  if (tabName === 'reports') initializeDefaultReportDates();
  if (tabName === 'edit-punches') refreshEditPunchesSelectors();
}

function refreshManagerUI() {
  // Employees tab
  renderEmployeesList();

  // Manager selects
  refreshManagerEmployeeSelectors();

  // Company settings UI
  const companyInput = $('company-name');
  if (companyInput) companyInput.value = loadString(STORAGE_KEYS.companyName, 'MVC') || 'MVC';
}

function refreshManagerEmployeeSelectors() {
  const employees = getEmployees().filter((e) => e && e.role !== 'admin' && e.id && e.name);
  const activeEmployees = employees.filter((e) => e.active !== false);

  const punchSelect = $('punch-employee');
  if (punchSelect) {
    punchSelect.innerHTML = activeEmployees
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((e) => `<option value="${e.id}">${e.name}</option>`)
      .join('');
  }

  const reportSelect = $('report-employee');
  if (reportSelect) {
    const current = reportSelect.value;
    reportSelect.innerHTML =
      '<option value="">All Employees</option>' +
      activeEmployees
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((e) => `<option value="${e.id}">${e.name}</option>`)
        .join('');
    reportSelect.value = current;
  }

  const editPunchesSelect = $('edit-punches-employee');
  if (editPunchesSelect) {
    const current = editPunchesSelect.value;
    editPunchesSelect.innerHTML =
      '<option value="">All Employees</option>' +
      employees
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((e) => `<option value="${e.id}">${e.name}</option>`)
        .join('');
    editPunchesSelect.value = current;
  }
}

// -----------------------------
// Employee Management (localStorage)
// -----------------------------
function getEmployeeStatusFilter() {
  return $('employee-status-filter')?.value || 'active';
}

function renderEmployeesList() {
  const container = $('employees-list');
  if (!container) return;

  const filter = getEmployeeStatusFilter();
  const employees = getEmployees().filter((e) => e && e.role !== 'admin');

  let list = employees;
  if (filter === 'active') list = employees.filter((e) => e.active !== false);
  if (filter === 'inactive') list = employees.filter((e) => e.active === false);

  if (list.length === 0) {
    container.innerHTML = '<p>No employees found.</p>';
    return;
  }

  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  container.innerHTML = list
    .map((emp) => {
      const isActive = emp.active !== false;
      const statusBadge = isActive
        ? '<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Active</span>'
        : '<span style="background: #dc3545; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Inactive</span>';
      const empNum = emp.employee_number ? `Employee #: ${emp.employee_number}` : '';
      const email = emp.email ? ` | Email: ${emp.email}` : '';
      const phone = emp.phone ? ` | Phone: ${emp.phone}` : '';
      return `
        <div class="employee-card">
          <div class="employee-info">
            <h4>${emp.name}${statusBadge}</h4>
            <p>${empNum}${email}${phone}</p>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-primary" data-action="edit-emp" data-id="${emp.id}">Edit</button>
            <button class="btn btn-danger" data-action="toggle-emp" data-id="${emp.id}">${isActive ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function openAddEmployeeModal() {
  $('add-employee-modal')?.classList.remove('hidden');
}

function closeAddEmployeeModal() {
  $('add-employee-modal')?.classList.add('hidden');
  $('add-employee-form')?.reset();
}

function handleAddEmployeeSubmit(e) {
  e.preventDefault();

  const name = $('emp-name')?.value?.trim();
  const employee_number = $('emp-number')?.value?.trim();
  const email = $('emp-email')?.value?.trim() || '';
  const phone = $('emp-phone')?.value?.trim() || '';

  if (!name || !employee_number) {
    showMessage('Name and employee number are required', 'error');
    return;
  }

  const employees = getEmployees();
  const exists = employees.some((emp) => emp && emp.role !== 'admin' && String(emp.employee_number) === String(employee_number));
  if (exists) {
    showMessage('Employee number already exists', 'error');
    return;
  }

  const id = `emp_${Date.now()}`;
  const newEmp = {
    id,
    name,
    role: 'employee',
    password: 'password123',
    employee_number,
    email,
    phone,
    active: true,
    createdAt: Date.now(),
  };

  employees.push(newEmp);
  setEmployees(employees);

  closeAddEmployeeModal();
  showMessage('Employee added successfully! Default password: password123', 'success');

  // Required: dropdown updates immediately
  updateUserDropdown();

  // Refresh manager UI lists/selects
  renderEmployeesList();
  refreshManagerEmployeeSelectors();
}

function openEditEmployeeModal(emp) {
  $('edit-emp-id').value = emp.id;
  $('edit-emp-name').value = emp.name || '';
  $('edit-emp-number').value = emp.employee_number || '';
  $('edit-emp-phone').value = emp.phone || '';
  $('edit-emp-password').value = '';
  $('edit-emp-status').value = emp.active !== false ? '1' : '0';
  $('edit-employee-modal')?.classList.remove('hidden');
}

function closeEditEmployeeModal() {
  $('edit-employee-modal')?.classList.add('hidden');
  $('edit-employee-form')?.reset();
}

function handleEditEmployeeSubmit(e) {
  e.preventDefault();

  const id = $('edit-emp-id')?.value;
  const name = $('edit-emp-name')?.value?.trim();
  const employee_number = $('edit-emp-number')?.value?.trim();
  const phone = $('edit-emp-phone')?.value?.trim() || '';
  const newPassword = $('edit-emp-password')?.value?.trim() || '';
  const active = $('edit-emp-status')?.value === '1';

  if (!id || !name || !employee_number) {
    showMessage('Name and employee number are required', 'error');
    return;
  }

  const employees = getEmployees();
  const duplicateNumber = employees.some(
    (emp) => emp && emp.id !== id && emp.role !== 'admin' && String(emp.employee_number) === String(employee_number)
  );
  if (duplicateNumber) {
    showMessage('Employee number already exists', 'error');
    return;
  }

  const idx = employees.findIndex((emp) => emp && emp.id === id);
  if (idx === -1) {
    showMessage('Employee not found', 'error');
    return;
  }

  const updated = { ...employees[idx], name, employee_number, phone, active };
  if (newPassword) updated.password = newPassword;

  employees[idx] = updated;
  setEmployees(employees);

  closeEditEmployeeModal();
  showMessage('Employee updated successfully', 'success');

  updateUserDropdown();
  renderEmployeesList();
  refreshManagerEmployeeSelectors();
}

function toggleEmployeeActive(empId) {
  const employees = getEmployees();
  const idx = employees.findIndex((e) => e && e.id === empId);
  if (idx === -1) return;

  employees[idx] = { ...employees[idx], active: employees[idx].active === false ? true : false };
  setEmployees(employees);

  renderEmployeesList();
  refreshManagerEmployeeSelectors();
  updateUserDropdown();
}

// -----------------------------
// Employee Punching (localStorage)
// -----------------------------
function getCurrentUserPunches() {
  if (!currentUser?.id) return [];
  return getPunches().filter((p) => p && p.employeeId === currentUser.id);
}

function updatePunchButtonStates() {
  const clockInBtn = $('clock-in-btn');
  const clockOutBtn = $('clock-out-btn');
  const lunchOutBtn = $('lunch-in-btn'); // "Go to Lunch" -> lunch_out
  const lunchInBtn = $('lunch-out-btn'); // "Return from Lunch" -> lunch_in
  if (!clockInBtn || !clockOutBtn || !lunchOutBtn || !lunchInBtn) return;

  const punches = getCurrentUserPunches();
  const today = localDateString(Date.now());
  const todays = punches.filter((p) => localDateString(p.timestamp) === today);

  const hasClockIn = todays.some((p) => p.punchType === 'clock_in');
  const hasClockOut = todays.some((p) => p.punchType === 'clock_out');
  const hasLunchOut = todays.some((p) => p.punchType === 'lunch_out');
  const hasLunchIn = todays.some((p) => p.punchType === 'lunch_in');

  clockInBtn.disabled = hasClockIn;
  clockOutBtn.disabled = !hasClockIn || hasClockOut;

  // Lunch logic: can only go to lunch after clock in, and can only return after going to lunch
  lunchOutBtn.disabled = !hasClockIn || hasLunchOut;
  lunchInBtn.disabled = !hasLunchOut || hasLunchIn;
}

function addPunch({ employeeId, employeeName, punchType, notes = '', createdById = null }) {
  const punches = getPunches();
  punches.push({
    id: `p_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    employeeId,
    employeeName,
    punchType,
    notes,
    createdById,
    timestamp: Date.now(),
  });
  setPunches(punches);
}

function handleEmployeePunch(punchType) {
  if (!currentUser) return;

  const noteText = $('punch-note')?.value?.trim() || '';
  const today = localDateString(Date.now());
  const todays = getCurrentUserPunches().filter((p) => localDateString(p.timestamp) === today);

  // Enforce one-per-day per type (clock_in specifically requested; keep consistent for others)
  if (todays.some((p) => p.punchType === punchType)) {
    showMessage('That punch has already been recorded today.', 'error');
    return;
  }

  // Simple dependencies
  const hasClockIn = todays.some((p) => p.punchType === 'clock_in');
  const hasLunchOut = todays.some((p) => p.punchType === 'lunch_out');

  if (punchType !== 'clock_in' && !hasClockIn) {
    showMessage('You must clock in first.', 'error');
    return;
  }
  if (punchType === 'lunch_in' && !hasLunchOut) {
    showMessage('You must go to lunch first.', 'error');
    return;
  }

  addPunch({
    employeeId: currentUser.id,
    employeeName: currentUser.name,
    punchType,
    notes: noteText,
    createdById: currentUser.id,
  });

  // Clear note after punch
  if ($('punch-note')) $('punch-note').value = '';

  // Render immediately (required)
  renderEmployeeRecords();
  updatePunchButtonStates();

  // Popups (use existing close functions in HTML)
  const firstName = getFirstName(currentUser.name);
  if (punchType === 'clock_in') showGreatDayModal(firstName);
  if (punchType === 'lunch_out') showLunchModal(firstName);
  if (punchType === 'lunch_in') showWelcomeBackModal(firstName);
  if (punchType === 'clock_out') showClockOutModal(firstName);
}

function renderEmployeeRecords() {
  const container = $('employee-records');
  if (!container || !currentUser) return;

  const punches = getCurrentUserPunches().slice().sort((a, b) => b.timestamp - a.timestamp);
  if (punches.length === 0) {
    container.innerHTML = '<p>No records found.</p>';
    return;
  }

  // group by day
  const byDay = {};
  punches.slice(0, 100).forEach((p) => {
    const day = localDateString(p.timestamp);
    byDay[day] = byDay[day] || [];
    byDay[day].push(p);
  });

  const days = Object.keys(byDay).sort((a, b) => new Date(b) - new Date(a));

  container.innerHTML = days
    .map((day) => {
      const dayPunches = byDay[day].slice().sort((a, b) => a.timestamp - b.timestamp);

      // calculate hours
      let clockIn = null;
      let clockOut = null;
      let lunchOut = null;
      let lunchIn = null;

      dayPunches.forEach((p) => {
        if (p.punchType === 'clock_in') clockIn = p.timestamp;
        if (p.punchType === 'clock_out') clockOut = p.timestamp;
        if (p.punchType === 'lunch_out') lunchOut = p.timestamp;
        if (p.punchType === 'lunch_in') lunchIn = p.timestamp;
      });

      let totalHours = 0;
      if (clockIn && clockOut && clockOut > clockIn) {
        totalHours = (clockOut - clockIn) / (1000 * 60 * 60);
        if (lunchOut && lunchIn && lunchIn > lunchOut) {
          totalHours -= (lunchIn - lunchOut) / (1000 * 60 * 60);
        }
        totalHours = Math.max(0, totalHours);
      }

      const punchesHtml = dayPunches
        .map((p) => {
          const hasNotes = p.notes && String(p.notes).trim().length > 0;
          return `
            <div class="record-item" style="margin-bottom: 8px;">
              <div>
                <span class="record-type ${String(p.punchType).replace('_', '-')}">${formatPunchType(p.punchType)}</span>
                <span style="margin-left: 15px;">${formatDateTime(p.timestamp)}</span>
                ${hasNotes ? `<div style="margin-top: 5px; padding: 8px; background: #f8f9fa; border-left: 3px solid #667eea; font-size: 13px; color: #555;"><strong>Note:</strong> ${String(p.notes).replace(/\n/g, '<br>')}</div>` : ''}
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div style="margin-bottom: 25px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h4 style="margin:0; color:#333; font-size:18px;">${formatDate(day)}</h4>
            <div style="font-weight:bold; font-size:16px; color:#667eea;">Total Hours: ${totalHours.toFixed(2)}</div>
          </div>
          <div>${punchesHtml}</div>
        </div>
      `;
    })
    .join('');
}

// -----------------------------
// Manual Punch (Manager)
// -----------------------------
function handleManualPunchSubmit(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'admin') return;

  const employeeId = $('punch-employee')?.value;
  const punchType = $('punch-type')?.value;
  const notes = $('punch-notes')?.value?.trim() || '';

  const employee = getEmployees().find((e) => e && e.id === employeeId);
  if (!employee) {
    showMessage('Employee not found', 'error');
    return;
  }

  addPunch({
    employeeId: employee.id,
    employeeName: employee.name,
    punchType,
    notes,
    createdById: currentUser.id,
  });

  $('manual-punch-form')?.reset();
  showMessage('Punch recorded successfully!', 'success');
}

// -----------------------------
// Reports (basic)
// -----------------------------
function initializeDefaultReportDates() {
  const startInput = $('report-start-date');
  const endInput = $('report-end-date');
  if (!startInput || !endInput) return;

  if (startInput.value && endInput.value) return;

  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diff));
  const start = localDateString(monday.getTime());
  const end = localDateString(new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000).getTime());

  startInput.value = start;
  endInput.value = end;
}

function generateReport() {
  const employeeId = $('report-employee')?.value || '';
  const startDate = $('report-start-date')?.value;
  const endDate = $('report-end-date')?.value;
  const container = $('report-results');
  const printBtn = $('print-report-btn');

  if (!container) return;

  if (!startDate || !endDate) {
    showMessage('Please select both starting date and end date', 'error');
    return;
  }

  if (new Date(startDate) > new Date(endDate)) {
    showMessage('Starting date must be before or equal to end date', 'error');
    return;
  }

  const punches = getPunches().filter((p) => {
    const day = localDateString(p.timestamp);
    if (day < startDate || day > endDate) return false;
    if (employeeId && p.employeeId !== employeeId) return false;
    return true;
  });

  if (punches.length === 0) {
    container.innerHTML = '<p>No records found for the selected date range.</p>';
    if (printBtn) printBtn.style.display = 'none';
    return;
  }

  // Group punches by employee -> day
  const byEmp = {};
  punches.forEach((p) => {
    byEmp[p.employeeId] = byEmp[p.employeeId] || { employeeId: p.employeeId, employeeName: p.employeeName, days: {} };
    const day = localDateString(p.timestamp);
    byEmp[p.employeeId].days[day] = byEmp[p.employeeId].days[day] || [];
    byEmp[p.employeeId].days[day].push(p);
  });

  const empCards = Object.values(byEmp)
    .sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)))
    .map((emp) => {
      let totalHours = 0;
      const daysHtml = Object.keys(emp.days)
        .sort((a, b) => new Date(a) - new Date(b))
        .map((day) => {
          const dayPunches = emp.days[day].slice().sort((a, b) => a.timestamp - b.timestamp);
          let clockIn = null;
          let clockOut = null;
          let lunchOut = null;
          let lunchIn = null;

          dayPunches.forEach((p) => {
            if (p.punchType === 'clock_in') clockIn = p.timestamp;
            if (p.punchType === 'clock_out') clockOut = p.timestamp;
            if (p.punchType === 'lunch_out') lunchOut = p.timestamp;
            if (p.punchType === 'lunch_in') lunchIn = p.timestamp;
          });

          let hours = 0;
          if (clockIn && clockOut && clockOut > clockIn) {
            hours = (clockOut - clockIn) / (1000 * 60 * 60);
            if (lunchOut && lunchIn && lunchIn > lunchOut) {
              hours -= (lunchIn - lunchOut) / (1000 * 60 * 60);
            }
            hours = Math.max(0, hours);
          }
          totalHours += hours;

          const punchesHtml = dayPunches
            .map((p) => `<div>${formatPunchType(p.punchType)}: ${formatDateTime(p.timestamp)}${p.notes ? ` (${p.notes})` : ''}</div>`)
            .join('');

          return `
            <div class="day-record">
              <div class="day-header">${formatDate(day)} - ${hours.toFixed(2)} hours</div>
              <div class="day-punches">${punchesHtml}</div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="report-card">
          <h4>${emp.employeeName}</h4>
          <div class="report-summary">
            <div class="total-hours">Total Hours: ${totalHours.toFixed(2)}</div>
          </div>
          ${daysHtml}
        </div>
      `;
    })
    .join('');

  container.innerHTML = empCards;
  if (printBtn) printBtn.style.display = 'inline-block';
}

function printReport() {
  window.print();
}

// -----------------------------
// Edit Punches (basic list + delete)
// -----------------------------
function refreshEditPunchesSelectors() {
  refreshManagerEmployeeSelectors();
}

function loadPunchesForEdit() {
  const container = $('edit-punches-list');
  if (!container) return;

  const employeeId = $('edit-punches-employee')?.value || '';
  const date = $('edit-punches-date')?.value || '';

  let punches = getPunches().slice().sort((a, b) => b.timestamp - a.timestamp);
  if (employeeId) punches = punches.filter((p) => p.employeeId === employeeId);
  if (date) punches = punches.filter((p) => localDateString(p.timestamp) === date);

  if (punches.length === 0) {
    container.innerHTML = '<p>No punches found.</p>';
    return;
  }

  container.innerHTML = punches.slice(0, 100).map((p) => `
    <div class="employee-card" style="margin-bottom: 15px;">
      <div style="flex: 1;">
        <h4>${p.employeeName}</h4>
        <p>
          <span class="record-type ${String(p.punchType).replace('_','-')}">${formatPunchType(p.punchType)}</span>
          <span style="margin-left: 15px;">${formatDateTime(p.timestamp)}</span>
          ${p.notes ? `<div style="margin-top: 5px; color: #666;">Note: ${p.notes}</div>` : ''}
        </p>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-danger" data-action="delete-punch" data-id="${p.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

function deletePunch(punchId) {
  const punches = getPunches().filter((p) => p.id !== punchId);
  setPunches(punches);
  loadPunchesForEdit();
  showMessage('Punch deleted successfully', 'success');
}

// -----------------------------
// Company Settings (localStorage)
// -----------------------------
function handleCompanySettingsSubmit(e) {
  e.preventDefault();
  const input = $('company-name');
  const msg = $('company-settings-message');
  const name = input?.value?.trim();

  if (!name) {
    if (msg) msg.innerHTML = '<p style="color: red;">Company name is required</p>';
    return;
  }

  saveString(STORAGE_KEYS.companyName, name);
  applyCompanyName();
  if (msg) msg.innerHTML = '<p style="color: green;">Company name saved.</p>';
}

// -----------------------------
// Popups (use existing close functions in HTML)
// -----------------------------
function showModal(modalId) {
  $(modalId)?.classList.remove('hidden');
}

function hideModal(modalId) {
  $(modalId)?.classList.add('hidden');
}

function showGreatDayModal(firstName) {
  const span = $('great-day-name');
  if (span) span.textContent = firstName || 'Employee';
  showModal('great-day-modal');
}

function showLunchModal(firstName) {
  const span = $('lunch-name');
  if (span) span.textContent = firstName || 'Employee';
  showModal('lunch-modal');
}

function showWelcomeBackModal(firstName) {
  const span = $('welcome-back-name');
  if (span) span.textContent = firstName || 'Employee';
  showModal('welcome-back-modal');
}

function showClockOutModal(firstName) {
  const span = $('clock-out-name');
  if (span) span.textContent = firstName || 'Employee';
  showModal('clock-out-modal');
}

// Required by HTML onclick handlers
window.closeGreatDayModal = () => hideModal('great-day-modal');
window.closeLunchModal = () => hideModal('lunch-modal');
window.closeWelcomeBackModal = () => hideModal('welcome-back-modal');
window.closeClockOutModal = () => hideModal('clock-out-modal');

// -----------------------------
// Init / Event wiring
// -----------------------------
function wireEvents() {
  $('login-form')?.addEventListener('submit', handleLoginSubmit);
  $('logout-btn')?.addEventListener('click', handleLogout);
  $('manager-logout-btn')?.addEventListener('click', handleLogout);

  // Employee punching
  $('clock-in-btn')?.addEventListener('click', () => handleEmployeePunch('clock_in'));
  $('clock-out-btn')?.addEventListener('click', () => handleEmployeePunch('clock_out'));
  $('lunch-in-btn')?.addEventListener('click', () => handleEmployeePunch('lunch_out')); // Go to Lunch
  $('lunch-out-btn')?.addEventListener('click', () => handleEmployeePunch('lunch_in')); // Return from Lunch

  // Manager tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Employee status filter
  $('employee-status-filter')?.addEventListener('change', () => renderEmployeesList());

  // Add employee modal open/close
  $('add-employee-btn')?.addEventListener('click', openAddEmployeeModal);
  document.querySelector('.close')?.addEventListener('click', closeAddEmployeeModal);
  $('cancel-add-btn')?.addEventListener('click', closeAddEmployeeModal);
  $('add-employee-form')?.addEventListener('submit', handleAddEmployeeSubmit);

  // Edit employee modal close/save
  document.querySelector('.close-edit')?.addEventListener('click', closeEditEmployeeModal);
  $('cancel-edit-btn')?.addEventListener('click', closeEditEmployeeModal);
  $('edit-employee-form')?.addEventListener('submit', handleEditEmployeeSubmit);

  // Employees list actions (edit/toggle)
  $('employees-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;

    if (action === 'edit-emp') {
      const emp = getEmployees().find((x) => x && x.id === id);
      if (emp) openEditEmployeeModal(emp);
    }
    if (action === 'toggle-emp') {
      toggleEmployeeActive(id);
    }
  });

  // Manual punch
  $('manual-punch-form')?.addEventListener('submit', handleManualPunchSubmit);

  // Reports
  $('generate-report-btn')?.addEventListener('click', generateReport);
  $('print-report-btn')?.addEventListener('click', printReport);

  // Edit punches
  $('load-punches-btn')?.addEventListener('click', loadPunchesForEdit);
  $('refresh-punches-btn')?.addEventListener('click', loadPunchesForEdit);
  $('edit-punches-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'delete-punch') {
      if (confirm('Are you sure you want to delete this punch?')) deletePunch(btn.dataset.id);
    }
  });

  // Company settings
  $('company-settings-form')?.addEventListener('submit', handleCompanySettingsSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
  ensureDefaults();
  applyCompanyName();
  wireEvents();

  // Required: run on page load
  updateUserDropdown();

  // Start on login page
  showOnlyPage('login-page');

  // Prep manager selectors + report dates (safe even if not logged in yet)
  refreshManagerEmployeeSelectors();
  initializeDefaultReportDates();
});

