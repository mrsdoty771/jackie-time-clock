// API base URL
const API_BASE = '/api';

// State
let currentUser = null;
let employees = [];
let currentWeekStart = null;
let loginOptions = { superAdmin: null };
let lastReportData = null;

// When any API returns 401 (e.g. idle timeout), show login and message
function handleSessionExpired(message) {
    currentUser = null;
    showLoginPage();
    const msgEl = document.getElementById('message');
    if (msgEl) {
        msgEl.textContent = message || 'Session expired due to inactivity. Please log in again.';
        msgEl.classList.remove('hidden');
        msgEl.style.color = '#666';
    }
}

// Wrap fetch so 401 from API triggers session-expired handling
const _originalFetch = window.fetch;
window.fetch = function (url) {
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    const isApi = urlStr.indexOf(API_BASE) !== -1;
    return _originalFetch.apply(this, arguments).then(function (res) {
        if (isApi && res.status === 401) {
            handleSessionExpired('Session expired due to inactivity. Please log in again.');
        }
        return res;
    });
};

// Initialize (run when DOM is ready; if app.js loads late, DOMContentLoaded may have already fired)
function init() {
    loadCompanyNameForLogin();
    setTimeout(() => {
        checkAuth();
    }, 100);
    setupEventListeners();
    initializeWeekStart();
    loadEmployeesForLogin();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function loadCompanyNameForLogin() {
    const companyId = getLoginCompanyId();
    if (!companyId) {
        updateLoginPageTitle('MVC');
        return;
    }
    fetch(`${API_BASE}/company-settings?companyId=${encodeURIComponent(companyId)}`)
        .then(res => res.json())
        .then(data => {
            const companyName = data.company_name || 'MVC';
            updateLoginPageTitle(companyName);
        })
        .catch(err => {
            console.error('Error loading company name:', err);
            // Default to MVC if error
            updateLoginPageTitle('MVC');
        });
}

function getLoginCompanyId() {
    const input = document.getElementById('company-id');
    return input ? input.value.trim() : '';
}

function initializeWeekStart() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    document.getElementById('report-start-date').value = monday.toISOString().split('T')[0];
    
    const endDate = new Date(monday);
    endDate.setDate(endDate.getDate() + 6);
    document.getElementById('report-end-date').value = endDate.toISOString().split('T')[0];
}

// Authentication
function checkAuth() {
    fetch(`${API_BASE}/me`, {
        credentials: 'include'
    })
        .then(async res => {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return res.json();
            } else {
                // Not logged in or server error - return null user
                return { user: null };
            }
        })
        .then(data => {
            if (data && data.user) {
                currentUser = data.user;
                showPage(data.user.role);
                loadInitialData();
            } else {
                showLoginPage();
                loadEmployeesForLogin();
            }
        })
        .catch((err) => {
            console.log('Auth check failed (this is normal if not logged in):', err);
            showLoginPage();
            loadEmployeesForLogin();
        });
}

function showLoginPage() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('employee-page').classList.add('hidden');
    document.getElementById('manager-page').classList.add('hidden');
}

function loadManagerNavCompanyName() {
    const el = document.getElementById('manager-nav-company');
    if (!el) return;
    fetch(`${API_BASE}/company-settings`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.logo_data) {
                el.innerHTML = '';
                const img = document.createElement('img');
                img.src = data.logo_data;
                img.alt = data.company_name || 'Company';
                img.className = 'navbar-logo';
                el.appendChild(img);
            } else {
                el.textContent = data.company_name || 'Company';
            }
        })
        .catch(() => { el.textContent = 'Company'; });
}

function showPage(role) {
    document.getElementById('login-page').classList.add('hidden');
    if (role === 'manager' || role === 'super-admin') {
        document.getElementById('manager-page').classList.remove('hidden');
        loadManagerNavCompanyName();
        loadEmployees();
        loadEmployeesForPunch();
        loadEmployeesForReport();
        loadEmployeesForEditPunches();
    } else {
        document.getElementById('employee-page').classList.remove('hidden');
        updateEmployeeNameDisplay();
        // Initialize button states to allow clock in until records load
        updatePunchButtonStates([]);
        loadEmployeeRecords();
    }
}

function updateEmployeeNameDisplay() {
    // If we have employee_name, use it
    if (currentUser.employee_name) {
        document.getElementById('employee-name').textContent = 'Hello ' + currentUser.employee_name;
        return;
    }
    
    // Otherwise, fetch it from the server
    if (currentUser.employee_id) {
        fetch(`${API_BASE}/employees`, {
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.length > 0) {
                    const employee = data.find(emp => emp.id === currentUser.employee_id) || data[0];
                    if (employee && employee.name) {
                        document.getElementById('employee-name').textContent = 'Hello ' + employee.name;
                        currentUser.employee_name = employee.name;
                    } else {
                        document.getElementById('employee-name').textContent = 'Hello Employee';
                    }
                } else {
                    document.getElementById('employee-name').textContent = 'Hello Employee';
                }
            })
            .catch(() => {
                document.getElementById('employee-name').textContent = 'Hello Employee';
            });
    } else {
        document.getElementById('employee-name').textContent = 'Hello Employee';
    }
}

// Event Listeners
function setupEventListeners() {
    // Login - prevent form submit, handle via fetch
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleLogin(e);
        return false;
    });
    document.getElementById('company-id')?.addEventListener('input', () => {
        loadCompanyNameForLogin();
        loadEmployeesForLogin();
    });
    
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('manager-logout-btn')?.addEventListener('click', handleLogout);
    
    // Employee punches
    document.getElementById('clock-in-btn')?.addEventListener('click', () => handlePunch('clock_in'));
    document.getElementById('clock-out-btn')?.addEventListener('click', () => handlePunch('clock_out'));
    document.getElementById('lunch-in-btn')?.addEventListener('click', () => handlePunch('lunch_out'));
    document.getElementById('lunch-out-btn')?.addEventListener('click', () => handlePunch('lunch_in'));
    
    // Manager tabs — use currentTarget so clicking the label/text still switches the tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.currentTarget.dataset.tab;
            if (tab) switchTab(tab);
        });
    });
    
    // Employee management
    document.getElementById('add-employee-btn')?.addEventListener('click', () => {
        document.getElementById('add-employee-modal').classList.remove('hidden');
    });
    
    document.getElementById('add-employee-form')?.addEventListener('submit', handleAddEmployee);
    document.getElementById('cancel-add-btn')?.addEventListener('click', () => {
        document.getElementById('add-employee-modal').classList.add('hidden');
        document.getElementById('add-employee-form').reset();
    });
    
    document.querySelector('.close')?.addEventListener('click', () => {
        document.getElementById('add-employee-modal').classList.add('hidden');
    });
    
    // Edit employee modal
    document.getElementById('edit-employee-form')?.addEventListener('submit', handleEditEmployee);
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
        document.getElementById('edit-employee-modal').classList.add('hidden');
        document.getElementById('edit-employee-form').reset();
    });
    
    document.querySelector('.close-edit')?.addEventListener('click', () => {
        document.getElementById('edit-employee-modal').classList.add('hidden');
    });
    
    // Phone number formatting for edit modal
    const editPhoneInput = document.getElementById('edit-emp-phone');
    if (editPhoneInput) {
        editPhoneInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
            if (value.length > 10) value = value.slice(0, 10); // Limit to 10 digits
            if (value.length >= 6) {
                value = value.slice(0, 3) + '-' + value.slice(3, 6) + '-' + value.slice(6);
            } else if (value.length >= 3) {
                value = value.slice(0, 3) + '-' + value.slice(3);
            }
            e.target.value = value;
        });
    }
    
    // Phone number formatting for add modal
    const addPhoneInput = document.getElementById('emp-phone');
    if (addPhoneInput) {
        addPhoneInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
            if (value.length > 10) value = value.slice(0, 10); // Limit to 10 digits
            if (value.length >= 6) {
                value = value.slice(0, 3) + '-' + value.slice(3, 6) + '-' + value.slice(6);
            } else if (value.length >= 3) {
                value = value.slice(0, 3) + '-' + value.slice(3);
            }
            e.target.value = value;
        });
    }
    
    // Manual punch
    document.getElementById('manual-punch-form')?.addEventListener('submit', handleManualPunch);
    
    // Reports
    document.getElementById('generate-report-btn')?.addEventListener('click', generateReport);
    document.getElementById('print-report-btn')?.addEventListener('click', printReport);
    document.getElementById('email-report-btn')?.addEventListener('click', emailReport);
    
    // Edit Punches
    document.getElementById('load-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    document.getElementById('refresh-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    document.getElementById('edit-punch-form')?.addEventListener('submit', handleEditPunchSubmit);
    document.getElementById('cancel-edit-punch-btn')?.addEventListener('click', () => document.getElementById('edit-punch-modal')?.classList.add('hidden'));
    document.querySelector('.close-edit-punch')?.addEventListener('click', () => document.getElementById('edit-punch-modal')?.classList.add('hidden'));
    
    // Company Settings
    document.getElementById('company-settings-form')?.addEventListener('submit', handleCompanySettings);
    document.getElementById('company-logo-choose')?.addEventListener('click', () => document.getElementById('company-logo-input')?.click());
    document.getElementById('company-logo-input')?.addEventListener('change', function () {
        const file = this.files?.[0];
        const preview = document.getElementById('company-logo-preview');
        const wrap = document.getElementById('company-logo-preview-wrap');
        const dataEl = document.getElementById('company-logo-data');
        if (!file || !file.type.startsWith('image/')) {
            if (wrap) wrap.classList.add('hidden');
            if (dataEl) dataEl.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            if (preview) preview.src = dataUrl;
            if (wrap) wrap.classList.remove('hidden');
            if (dataEl) dataEl.value = dataUrl;
        };
        reader.readAsDataURL(file);
        this.value = '';
    });
    document.getElementById('company-logo-remove')?.addEventListener('click', () => {
        document.getElementById('company-logo-preview').src = '';
        document.getElementById('company-logo-preview-wrap')?.classList.add('hidden');
        document.getElementById('company-logo-data').value = '';
        document.getElementById('company-logo-input').value = '';
    });

    // Manager profile (My Account)
    document.getElementById('manager-profile-form')?.addEventListener('submit', handleManagerProfileSubmit);
    document.getElementById('send-test-email-btn')?.addEventListener('click', handleSendTestEmail);

    // My Account: eye toggles password visibility (same pattern for both)
    document.getElementById('profile-smtp-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('profile-smtp-password');
        const btn = document.getElementById('profile-smtp-password-toggle');
        const showIcon = btn?.querySelector('.pwd-icon-show');
        const hideIcon = btn?.querySelector('.pwd-icon-hide');
        if (!input || !btn) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        btn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
        if (showIcon) showIcon.style.display = isPassword ? 'none' : '';
        if (hideIcon) hideIcon.style.display = isPassword ? '' : 'none';
    });

    // Edit Employee: same eye toggle as My Account (direct listener on the button)
    document.getElementById('edit-emp-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const input = document.getElementById('edit-emp-password');
        const btn = document.getElementById('edit-emp-password-toggle');
        const showIcon = btn?.querySelector('.pwd-icon-show');
        const hideIcon = btn?.querySelector('.pwd-icon-hide');
        if (!input || !btn) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        btn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
        if (showIcon) showIcon.style.display = isPassword ? 'none' : '';
        if (hideIcon) hideIcon.style.display = isPassword ? '' : 'none';
    });

    setupEditPasswordPlaceholder();
    
    // Employee Status Filter
    document.getElementById('employee-status-filter')?.addEventListener('change', (e) => {
        const status = e.target.value;
        loadEmployees(status);
    });

    // Employee Management dropdown: show selected employee details
    document.getElementById('employee-management-select')?.addEventListener('change', updateEmployeeManagementDetails);

    // Email Report modal
    document.getElementById('email-report-form')?.addEventListener('submit', handleEmailReportSubmit);
    document.getElementById('cancel-email-report-btn')?.addEventListener('click', closeEmailReportModal);
    document.querySelector('.close-email-report')?.addEventListener('click', closeEmailReportModal);
}

function loadEmployeesForLogin() {
    const select = document.getElementById('user-select');
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = '<option value="">-- Select Name --</option>' +
        '<option value="admin">Admin (Manager)</option>' +
        '<option value="Josh">Josh</option>';

    const companyId = getLoginCompanyId();

    Promise.all([
        fetch(`${API_BASE}/login-options`, { credentials: 'include' }).then(r => r.json()),
        companyId ? fetch(`${API_BASE}/employees/public?companyId=${encodeURIComponent(companyId)}`).then(r => r.json()) : Promise.resolve([])
    ]).then(([opts, empData]) => {
        loginOptions = opts || { superAdmin: null };
        const superAdminOpt = loginOptions.superAdmin
            ? '<option value="superadmin">Super Admin</option>'
            : '';
        const employeeOptions = (empData || []).map(emp =>
            `<option value="emp_${emp.id}">${emp.name}</option>`
        ).join('');
        select.innerHTML = '<option value="">-- Select Name --</option>' +
            '<option value="admin">Admin (Manager)</option>' +
            '<option value="Josh">Josh</option>' +
            superAdminOpt +
            employeeOptions;
        if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
            select.value = previousValue;
        }
    }).catch(err => {
        console.error('Error loading login options or employees:', err);
        if (companyId) {
            fetch(`${API_BASE}/employees/public?companyId=${encodeURIComponent(companyId)}`)
                .then(res => res.json())
                .then(data => {
                    const employeeOptions = (data || []).map(emp =>
                        `<option value="emp_${emp.id}">${emp.name}</option>`
                    ).join('');
                    select.innerHTML = '<option value="">-- Select Name --</option>' +
                        '<option value="admin">Admin (Manager)</option>' +
                        '<option value="Josh">Josh</option>' + employeeOptions;
                    if (previousValue && select.querySelector(`option[value="${previousValue}"]`)) {
                        select.value = previousValue;
                    }
                })
                .catch(e => console.error('Error loading employees:', e));
        }
    });
}

function handleLogin(e) {
    e.preventDefault();
    const selectedValue = document.getElementById('user-select').value;
    const password = document.getElementById('password').value;
    const companyId = getLoginCompanyId();
    const errorDiv = document.getElementById('login-error');
    
    if (!selectedValue) {
        errorDiv.textContent = 'Please select a name';
        return;
    }

    const isSuperAdmin = selectedValue === 'superadmin' && loginOptions.superAdmin;
    if (!isSuperAdmin && !companyId) {
        errorDiv.textContent = 'Please enter your Company ID';
        return;
    }

    let loginData;

    if (isSuperAdmin) {
        loginData = {
            username: loginOptions.superAdmin.username,
            password,
            companyId: loginOptions.superAdmin.companyId
        };
    } else if (selectedValue === 'admin') {
        loginData = { username: 'admin', password, companyId };
    } else if (selectedValue === 'Josh') {
        loginData = { username: 'Josh', password, companyId };
    } else if (selectedValue.startsWith('emp_')) {
        const employeeId = selectedValue.replace('emp_', '');
        loginData = { employee_id: employeeId, password, companyId };
    } else {
        errorDiv.textContent = 'Please select a name';
        return;
    }
    
    fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData),
        credentials: 'include'
    })
    .then(async res => {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return res.json();
        } else {
            // Server returned non-JSON (probably HTML error page)
            const text = await res.text();
            console.error('Login returned non-JSON:', text.substring(0, 200));
            throw new Error('Server error. Please try again.');
        }
    })
    .then(data => {
        console.log('Login response:', data);
        if (data.success) {
            currentUser = data.user;
            showPage(data.user.role);
            loadInitialData();
            document.getElementById('login-form').reset();
            errorDiv.textContent = '';
        } else {
            const errMsg = data.error || 'Invalid password';
            console.error('Login failed:', errMsg);
            errorDiv.textContent = errMsg;
            errorDiv.style.color = 'red';
            errorDiv.style.fontWeight = 'bold';
            alert('Login failed: ' + errMsg);
        }
    })
    .catch(err => {
        console.error('Login error:', err);
        const errMsg = err.message || 'Login failed. Please try again.';
        errorDiv.textContent = errMsg;
        errorDiv.style.color = 'red';
        errorDiv.style.fontWeight = 'bold';
        alert('Login error: ' + errMsg);
    });
}

function handleLogout() {
    fetch(`${API_BASE}/logout`, { 
        method: 'POST',
        credentials: 'include'
    })
        .then(() => {
            currentUser = null;
            showLoginPage();
        });
}

// Employee Functions
function handlePunch(punchType) {
    // Get note from textarea
    const noteTextarea = document.getElementById('punch-note');
    const noteText = noteTextarea ? noteTextarea.value.trim() : '';
    
    fetch(`${API_BASE}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            punch_type: punchType,
            notes: noteText || null
        }),
        credentials: 'include'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            // Get employee name for personalized messages (just first name)
            const fullName = currentUser?.employee_name || currentUser?.username || 'Employee';
            const firstName = getFirstName(fullName);
            
            // Show popup for clock in, lunch in, lunch out, and clock out
            if (punchType === 'clock_in') {
                showGreatDayModal(firstName);
            } else if (punchType === 'lunch_in') {
                showWelcomeBackModal(firstName);
            } else if (punchType === 'lunch_out') {
                showLunchModal(firstName);
            } else if (punchType === 'clock_out') {
                showClockOutModal(firstName);
            } else {
                showMessage('Punch recorded successfully!', 'success');
            }
            // Clear the note box after successful submission
            if (noteTextarea) {
                noteTextarea.value = '';
            }
            loadEmployeeRecords();
        } else {
            showMessage(data.error || 'Failed to record punch', 'error');
        }
    })
    .catch(err => {
        showMessage('Error recording punch', 'error');
    });
}

function loadEmployeeRecords() {
    fetch(`${API_BASE}/punches`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            displayEmployeeRecords(data);
            updatePunchButtonStates(data);
        })
        .catch(err => {
            console.error('Error loading records:', err);
            // If records fail to load, enable clock in button (allow user to clock in)
            updatePunchButtonStates([]);
        });
}

function updatePunchButtonStates(records) {
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const lunchInBtn = document.getElementById('lunch-in-btn');
    const lunchOutBtn = document.getElementById('lunch-out-btn');
    
    if (!clockInBtn || !clockOutBtn || !lunchInBtn || !lunchOutBtn) return;
    
    // Helper function to get local date string in YYYY-MM-DD format
    function getLocalDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Get today's date in YYYY-MM-DD format (local time)
    const today = new Date();
    const todayStr = getLocalDateString(today);
    
    // Helper function to set button state
    function setButtonState(btn, disabled) {
        if (disabled) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    }
    
    if (records && records.length > 0) {
        // Filter records for today only (using local dates)
        const todayRecords = records.filter(record => {
            const recordDate = new Date(record.punch_time);
            const recordDateStr = getLocalDateString(recordDate);
            return recordDateStr === todayStr;
        });
        
        // Check which punch types were used today
        const hasClockIn = todayRecords.some(r => r.punch_type === 'clock_in');
        const hasClockOut = todayRecords.some(r => r.punch_type === 'clock_out');
        const hasLunchIn = todayRecords.some(r => r.punch_type === 'lunch_in');
        const hasLunchOut = todayRecords.some(r => r.punch_type === 'lunch_out');
        
        // Disable buttons if that punch type was already used today
        // Also check logical dependencies (can't clock out/lunch without clocking in first)
        // Note: lunch-in-btn records lunch_out, lunch-out-btn records lunch_in
        setButtonState(clockInBtn, hasClockIn);
        setButtonState(clockOutBtn, hasClockOut || !hasClockIn);
        setButtonState(lunchInBtn, hasLunchOut || !hasClockIn); // lunch-in-btn = "Go to Lunch" = lunch_out
        setButtonState(lunchOutBtn, hasLunchIn || !hasLunchOut); // lunch-out-btn = "Return from Lunch" = lunch_in
    } else {
        // No records, enable clock in only (can't clock out if never clocked in)
        setButtonState(clockInBtn, false);
        setButtonState(clockOutBtn, true);
        setButtonState(lunchInBtn, true);
        setButtonState(lunchOutBtn, true);
    }
}

function displayEmployeeRecords(records) {
    const container = document.getElementById('employee-records');
    if (records.length === 0) {
        container.innerHTML = '<p>No records found.</p>';
        return;
    }
    
    // Group records by day
    const recordsByDay = {};
    records.slice(0, 100).forEach(record => {
        const date = new Date(record.punch_time);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format
        
        if (!recordsByDay[dateStr]) {
            recordsByDay[dateStr] = [];
        }
        recordsByDay[dateStr].push(record);
    });
    
    // Sort days (most recent first)
    const sortedDays = Object.keys(recordsByDay).sort((a, b) => new Date(b) - new Date(a));
    
    // Generate HTML for each day
    const daysHtml = sortedDays.map(dateStr => {
        const dayRecords = recordsByDay[dateStr].sort((a, b) => 
            new Date(a.punch_time) - new Date(b.punch_time)
        );
        
        // Calculate total hours for the day
        let clockIn = null;
        let clockOut = null;
        let lunchIn = null;
        let lunchOut = null;
        
        dayRecords.forEach(record => {
            const punchTime = new Date(record.punch_time);
            if (record.punch_type === 'clock_in') clockIn = punchTime;
            if (record.punch_type === 'clock_out') clockOut = punchTime;
            // Note: lunch_in means returning from lunch, lunch_out means going to lunch
            if (record.punch_type === 'lunch_in') lunchIn = punchTime; // Return from lunch
            if (record.punch_type === 'lunch_out') lunchOut = punchTime; // Go to lunch
        });
        
        let totalHours = 0;
        if (clockIn && clockOut) {
            totalHours = (clockOut - clockIn) / (1000 * 60 * 60);
            // Subtract lunch time: lunchOut is when they left, lunchIn is when they returned
            if (lunchOut && lunchIn && lunchOut < lunchIn) {
                const lunchHours = (lunchIn - lunchOut) / (1000 * 60 * 60);
                totalHours -= lunchHours;
            }
            totalHours = Math.max(0, totalHours);
        }
        
        const displayDate = formatDate(dateStr);
        const punchesHtml = dayRecords.map(record => {
            const date = new Date(record.punch_time);
            const typeClass = record.punch_type.replace('_', '-');
            const hasNotes = record.notes && record.notes.trim().length > 0;
            return `
                <div class="record-item" style="margin-bottom: 8px;">
                    <div>
                        <span class="record-type ${typeClass}">${formatPunchType(record.punch_type)}</span>
                        <span style="margin-left: 15px;">${formatDateTime(date)}</span>
                        ${hasNotes ? `<div style="margin-top: 5px; padding: 8px; background: #f8f9fa; border-left: 3px solid #667eea; font-size: 13px; color: #555;"><strong>Note:</strong> ${record.notes.replace(/\n/g, '<br>')}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        return `
            <div style="margin-bottom: 25px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: #333; font-size: 18px;">${displayDate}</h4>
                    <div style="font-weight: bold; font-size: 16px; color: #667eea;">Total Hours: ${totalHours.toFixed(2)}</div>
                </div>
                <div>${punchesHtml}</div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = daysHtml;
}

// Manager Functions
function loadInitialData() {
    if (currentUser?.role === 'manager' || currentUser?.role === 'super-admin') {
        loadEmployees();
        loadEmployeesForPunch();
        loadEmployeesForReport();
    }
}

function loadEmployees(status = 'active') {
    const url = status ? `${API_BASE}/employees?status=${status}` : `${API_BASE}/employees`;
    fetch(url, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            employees = data;
            displayEmployees(data);
        })
        .catch(err => {
            console.error('Error loading employees:', err);
        });
}

function displayEmployees(employeesList) {
    const select = document.getElementById('employee-management-select');
    const detailsContainer = document.getElementById('employee-management-details');
    if (!select || !detailsContainer) return;

    const optionsHtml = '<option value="">-- Select an employee --</option>' +
        employeesList.map(emp => `<option value="${String(emp.id)}">${emp.name} (${emp.employee_number})</option>`).join('');
    select.innerHTML = employeesList.length === 0 ? '<option value="">-- Select an employee --</option>' : optionsHtml;

    if (employeesList.length === 0) {
        detailsContainer.innerHTML = '<p>No employees found. Add your first employee!</p>';
        return;
    }

    updateEmployeeManagementDetails();
}

function updateEmployeeManagementDetails() {
    const select = document.getElementById('employee-management-select');
    const detailsContainer = document.getElementById('employee-management-details');
    if (!select || !detailsContainer) return;

    const selectedId = select.value;
    if (!selectedId) {
        detailsContainer.innerHTML = '<p style="color: #666;">Select an employee from the dropdown above to view details and edit or remove.</p>';
        return;
    }

    const emp = employees.find(e => String(e.id) === selectedId);
    if (!emp) {
        detailsContainer.innerHTML = '<p style="color: #666;">Select an employee from the dropdown above.</p>';
        return;
    }

    const statusBadge = emp.active === 1 || emp.active === '1'
        ? '<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Active</span>'
        : '<span style="background: #dc3545; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Inactive</span>';

    detailsContainer.innerHTML = `
        <div class="employee-card">
            <div class="employee-info">
                <h4>${emp.name}${statusBadge}</h4>
                <p>Employee #: ${emp.employee_number}${emp.email ? ` | Email: ${emp.email}` : ''}${emp.phone ? ` | Phone: ${emp.phone}` : ''}</p>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-primary" onclick="editEmployee('${String(emp.id)}')">Edit</button>
                <button class="btn btn-danger" onclick="removeEmployee('${String(emp.id)}')">Remove</button>
            </div>
        </div>
    `;
}

function loadEmployeesForPunch() {
    const select = document.getElementById('punch-employee');
    if (!select) return;
    fetch(`${API_BASE}/employees`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            const list = Array.isArray(data) ? data : [];
            select.innerHTML = '<option value="">-- Select Employee --</option>' +
                list.map(emp => `<option value="${emp.id}">${emp.name} (${emp.employee_number || ''})</option>`).join('');
        })
        .catch(() => {
            select.innerHTML = '<option value="">-- Error loading employees --</option>';
        });
}

function loadEmployeesForReport() {
    fetch(`${API_BASE}/employees`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('report-employee');
            const currentValue = select.value;
            select.innerHTML = '<option value="">All Employees</option>' + 
                data.map(emp => `<option value="${emp.id}">${emp.name}</option>`).join('');
            select.value = currentValue;
        });
}

function loadEmployeesForEditPunches() {
    fetch(`${API_BASE}/employees`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('edit-punches-employee');
            if (select) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">All Employees</option>' + 
                    data.map(emp => `<option value="${emp.id}">${emp.name}</option>`).join('');
                select.value = currentValue;
            }
        });
}

function loadPunchesForEdit() {
    const employeeId = document.getElementById('edit-punches-employee').value;
    const date = document.getElementById('edit-punches-date').value;
    
    let url = `${API_BASE}/punches?`;
    if (employeeId) {
        url += `employee_id=${employeeId}&`;
    }
    if (date) {
        url += `start_date=${date}&end_date=${date}`;
    }
    
    fetch(url, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            displayPunchesForEdit(data);
        })
        .catch(err => {
            showMessage('Error loading punches', 'error');
        });
}

function displayPunchesForEdit(punches) {
    const container = document.getElementById('edit-punches-list');
    if (!punches || punches.length === 0) {
        container.innerHTML = '<p>No punches found.</p>';
        return;
    }
    
    container.innerHTML = punches.slice(0, 50).map(punch => {
        const date = new Date(punch.punch_time);
        const typeClass = punch.punch_type.replace('_', '-');
        return `
            <div class="employee-card" style="margin-bottom: 15px;">
                <div style="flex: 1;">
                    <h4>${punch.employee_name || 'Employee'} (${punch.employee_number || ''})</h4>
                    <p>
                        <span class="record-type ${typeClass}">${formatPunchType(punch.punch_type)}</span>
                        <span style="margin-left: 15px;">${formatDateTime(date)}</span>
                        ${punch.notes ? `<div style="margin-top: 5px; color: #666;">Note: ${punch.notes}</div>` : ''}
                    </p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-primary" onclick="editPunch('${String(punch.id)}')">Edit</button>
                    <button class="btn btn-danger" onclick="deletePunch('${String(punch.id)}')">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function editPunch(id) {
    if (!id) return;
    fetch(`${API_BASE}/punches/${id}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showMessage(data.error || 'Punch not found', 'error');
                return;
            }
            const d = data.punch_time ? new Date(data.punch_time) : new Date();
            const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
            document.getElementById('edit-punch-id').value = data.id || id;
            document.getElementById('edit-punch-type').value = data.punch_type || 'clock_in';
            document.getElementById('edit-punch-date').value = dateStr;
            document.getElementById('edit-punch-time').value = timeStr;
            document.getElementById('edit-punch-notes').value = data.notes || '';
            document.getElementById('edit-punch-modal').classList.remove('hidden');
        })
        .catch(() => showMessage('Error loading punch', 'error'));
}

function handleEditPunchSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-punch-id').value;
    if (!id) return;
    const punchType = document.getElementById('edit-punch-type').value;
    const date = document.getElementById('edit-punch-date').value;
    const time = document.getElementById('edit-punch-time').value;
    const notes = document.getElementById('edit-punch-notes').value.trim();
    const punchTime = date && time ? `${date}T${time}` : new Date().toISOString();
    fetch(`${API_BASE}/punches/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ punch_type: punchType, punch_time: punchTime, notes: notes || null })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                document.getElementById('edit-punch-modal').classList.add('hidden');
                showMessage('Punch updated', 'success');
                loadPunchesForEdit();
            } else {
                showMessage(data.error || 'Failed to update punch', 'error');
            }
        })
        .catch(() => showMessage('Error updating punch', 'error'));
}

function deletePunch(id) {
    if (!confirm('Are you sure you want to delete this punch?')) return;
    
    fetch(`${API_BASE}/punches/${id}`, {
        method: 'DELETE',
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showMessage('Punch deleted successfully', 'success');
                loadPunchesForEdit();
            } else {
                showMessage(data.error || 'Failed to delete punch', 'error');
            }
        })
        .catch(err => {
            showMessage('Error deleting punch', 'error');
        });
}

function formatPhoneNumber(phone) {
    if (!phone) return '';
    // Remove any existing dashes or non-digits
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 0) return '';
    if (digits.length > 10) digits = digits.slice(0, 10);
    // Format as XXX-XXX-XXXX
    if (digits.length >= 6) {
        return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
    } else if (digits.length >= 3) {
        return digits.slice(0, 3) + '-' + digits.slice(3);
    }
    return digits;
}

function editEmployee(id) {
    const idStr = String(id);
    fetch(`${API_BASE}/employees/${idStr}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showMessage(data.error || 'Employee not found', 'error');
                return;
            }
            populateEditForm(data);
        })
        .catch(() => showMessage('Error loading employee', 'error'));
}

const EDIT_PASSWORD_PLACEHOLDER = '••••••••';

function populateEditForm(employee) {
    document.getElementById('edit-emp-id').value = employee.id;
    document.getElementById('edit-emp-name').value = employee.name || '';
    document.getElementById('edit-emp-number').value = employee.employee_number || '';
    document.getElementById('edit-emp-phone').value = formatPhoneNumber(employee.phone || '');
    const pwdInput = document.getElementById('edit-emp-password');
    const hasRealPassword = employee.password != null && String(employee.password).trim() !== '';
    if (hasRealPassword) {
        pwdInput.value = employee.password;
        pwdInput.removeAttribute('data-is-placeholder');
    } else {
        pwdInput.value = EDIT_PASSWORD_PLACEHOLDER;
        pwdInput.setAttribute('data-is-placeholder', '1');
    }
    pwdInput.type = 'password';
    const pwdBtn = document.getElementById('edit-emp-password-toggle');
    if (pwdBtn) {
        pwdBtn.setAttribute('aria-label', 'Show password');
        pwdBtn.setAttribute('title', 'Show password');
        const showIcon = pwdBtn.querySelector('.pwd-icon-show');
        const hideIcon = pwdBtn.querySelector('.pwd-icon-hide');
        if (showIcon) showIcon.style.display = '';
        if (hideIcon) hideIcon.style.display = 'none';
    }
    document.getElementById('edit-emp-status').value = (employee.active === 1 || employee.active === '1') ? '1' : '0';
    document.getElementById('edit-employee-modal').classList.remove('hidden');
}

function setupEditPasswordPlaceholder() {
    const input = document.getElementById('edit-emp-password');
    if (!input) return;
    input.addEventListener('focus', function () {
        if (this.getAttribute('data-is-placeholder') === '1') {
            this.value = '';
            this.removeAttribute('data-is-placeholder');
        }
    });
    input.addEventListener('blur', function () {
        if (this.value.trim() === '') {
            this.value = EDIT_PASSWORD_PLACEHOLDER;
            this.setAttribute('data-is-placeholder', '1');
        }
    });
}

function handleEditEmployee(e) {
    e.preventDefault();
    const id = document.getElementById('edit-emp-id').value;
    let newPassword = document.getElementById('edit-emp-password').value.trim();
    if (newPassword === EDIT_PASSWORD_PLACEHOLDER) newPassword = '';
    const employee = {
        name: document.getElementById('edit-emp-name').value,
        employee_number: document.getElementById('edit-emp-number').value,
        phone: document.getElementById('edit-emp-phone').value,
        active: parseInt(document.getElementById('edit-emp-status').value)
    };
    if (newPassword) employee.password = newPassword;

    fetch(`${API_BASE}/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee),
        credentials: 'include'
    })
    .then(async res => {
        const contentType = res.headers.get('content-type');
        let data;
        if (contentType && contentType.includes('application/json')) {
            data = await res.json();
        } else {
            const text = await res.text();
            throw new Error(text || 'Server error');
        }
        if (!res.ok) throw new Error(data.error || 'Failed to update employee');
        return data;
    })
    .then(data => {
        if (data.error) throw new Error(data.error);
        showMessage(newPassword ? 'Employee and password updated successfully' : 'Employee updated successfully', 'success');
        document.getElementById('edit-employee-modal').classList.add('hidden');
        document.getElementById('edit-employee-form').reset();
        const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
        loadEmployees(currentFilter);
        loadEmployeesForPunch();
        loadEmployeesForReport();
    })
    .catch(err => {
        console.error('Error updating employee:', err);
        showMessage('Error updating employee: ' + (err.message || err), 'error');
    });
}

function removeEmployee(id) {
    if (!confirm('Are you sure you want to remove this employee?')) return;
    
    fetch(`${API_BASE}/employees/${id}`, { 
        method: 'DELETE',
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showMessage('Employee removed successfully', 'success');
                // Reload with current filter
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
                loadEmployeesForPunch();
                loadEmployeesForReport();
            }
        })
        .catch(err => {
            showMessage('Error removing employee', 'error');
        });
}

function handleAddEmployee(e) {
    e.preventDefault();
    const passwordInput = document.getElementById('emp-password');
    const employee = {
        name: document.getElementById('emp-name').value,
        employee_number: document.getElementById('emp-number').value,
        email: document.getElementById('emp-email').value,
        phone: document.getElementById('emp-phone').value
    };
    if (passwordInput && passwordInput.value.trim()) {
        employee.password = passwordInput.value;
    }

    fetch(`${API_BASE}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee),
        credentials: 'include'
    })
    .then(res => res.json())
        .then(data => {
        if (data.success) {
            const tempPwd = data.temp_password ? ` Temporary password: ${data.temp_password}` : ' They can log in with the password you set and change it later.';
            showMessage('Employee added successfully!' + tempPwd, 'success');
            document.getElementById('add-employee-modal').classList.add('hidden');
            document.getElementById('add-employee-form').reset();
            // Reload with current filter
            const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
            loadEmployees(currentFilter);
            loadEmployeesForPunch();
            loadEmployeesForReport();
            // Login dropdown is loaded on the login page based on Company ID input
        } else {
            showMessage(data.error || 'Failed to add employee', 'error');
        }
    })
    .catch(err => {
        showMessage('Error adding employee', 'error');
    });
}

function handleManualPunch(e) {
    e.preventDefault();
    const employeeId = document.getElementById('punch-employee')?.value?.trim();
    if (!employeeId) {
        showMessage('Please select an employee.', 'error');
        return;
    }
    const punch = {
        employee_id: employeeId,
        punch_type: document.getElementById('punch-type').value,
        notes: document.getElementById('punch-notes').value.trim() || null
    };

    fetch(`${API_BASE}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(punch),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim()) data = JSON.parse(text);
            } catch (_) {}
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                showMessage('Punch recorded successfully!', 'success');
                document.getElementById('manual-punch-form').reset();
                const select = document.getElementById('punch-employee');
                if (select && select.options.length) select.selectedIndex = 0;
            } else {
                showMessage(data.error || 'Failed to record punch', 'error');
            }
        })
        .catch(() => {
            showMessage('Error recording punch. Check the server and try again.', 'error');
        });
}

function generateReport() {
    const employeeId = document.getElementById('report-employee').value;
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;
    
    if (!startDate || !endDate) {
        showMessage('Please select both starting date and end date', 'error');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showMessage('Starting date must be before or equal to end date', 'error');
        return;
    }
    
    let url = `${API_BASE}/reports/weekly?start_date=${startDate}&end_date=${endDate}`;
    if (employeeId) {
        url += `&employee_id=${employeeId}`;
    }
    
    fetch(url, {
        credentials: 'include'
    })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `Report failed (${res.status})`);
            }
            return data;
        })
        .then((data) => {
            if (!Array.isArray(data)) {
                showMessage('Invalid report data received', 'error');
                return;
            }
            lastReportData = data;
            displayReport(data);
        })
        .catch((err) => {
            showMessage(err.message || 'Error generating report', 'error');
        });
}

function displayReport(reportData) {
    const container = document.getElementById('report-results');
    const printBtn = document.getElementById('print-report-btn');
    if (!container) return;
    if (!Array.isArray(reportData)) {
        container.innerHTML = '<p>No report data.</p>';
        if (printBtn) printBtn.style.display = 'none';
        document.getElementById('email-report-btn').style.display = 'none';
        return;
    }
    if (reportData.length === 0) {
        container.innerHTML = '<p>No records found for the selected date range.</p>';
        if (printBtn) printBtn.style.display = 'none';
        document.getElementById('email-report-btn').style.display = 'none';
        return;
    }
    
    // Show print and email buttons if there's data
    if (printBtn) printBtn.style.display = 'inline-block';
    const emailBtn = document.getElementById('email-report-btn');
    if (emailBtn) emailBtn.style.display = 'inline-block';
    
    container.innerHTML = reportData.map(emp => {
        const daysHtml = Object.values(emp.days).map(day => {
            const punchesHtml = day.punches.map(p => {
                const date = new Date(p.time);
                return `<div>${formatPunchType(p.type)}: ${formatDateTime(date)}${p.notes ? ` (${p.notes})` : ''}</div>`;
            }).join('');
            
            return `
                <div class="day-record">
                    <div class="day-header">${formatDate(day.date)} - ${day.hours} hours</div>
                    <div class="day-punches">${punchesHtml}</div>
                </div>
            `;
        }).join('');
        
        return `
            <div class="report-card">
                <h4>${emp.employee_name} (${emp.employee_number})</h4>
                <div class="report-summary">
                    <div class="total-hours">Total Hours: ${emp.total_hours}</div>
                </div>
                ${daysHtml}
            </div>
        `;
    }).join('');
}

function printReport() {
    const reportResults = document.getElementById('report-results');
    if (!reportResults || reportResults.innerHTML.trim() === '' || reportResults.innerHTML.includes('No records found')) {
        showMessage('No report to print. Please generate a report first.', 'error');
        return;
    }
    
    // Get report date range
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;
    const employeeSelect = document.getElementById('report-employee');
    const selectedEmployee = employeeSelect.options[employeeSelect.selectedIndex].text;
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    
    // Get the report HTML
    const reportHTML = reportResults.innerHTML;
    
    // Create print-friendly HTML
    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Time Clock Report</title>
            <style>
                @media print {
                    @page {
                        margin: 1cm;
                    }
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: Arial, sans-serif;
                    }
                    .no-print {
                        display: none !important;
                    }
                }
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    color: #333;
                }
                .report-header {
                    text-align: center;
                    margin-bottom: 30px;
                    border-bottom: 2px solid #667eea;
                    padding-bottom: 15px;
                }
                .report-header h1 {
                    margin: 0;
                    color: #667eea;
                    font-size: 24px;
                }
                .report-header p {
                    margin: 5px 0;
                    color: #666;
                }
                .report-card {
                    background: white;
                    padding: 20px;
                    margin-bottom: 25px;
                    border: 1px solid #ddd;
                    page-break-inside: avoid;
                }
                .report-card h4 {
                    color: #667eea;
                    margin-bottom: 15px;
                    font-size: 18px;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                }
                .report-summary {
                    background: #f8f9fa;
                    padding: 15px;
                    margin-bottom: 15px;
                    border-radius: 5px;
                }
                .total-hours {
                    font-size: 20px;
                    font-weight: bold;
                    color: #667eea;
                }
                .day-record {
                    padding: 10px;
                    border-bottom: 1px solid #e0e0e0;
                    margin-bottom: 10px;
                }
                .day-record:last-child {
                    border-bottom: none;
                }
                .day-header {
                    font-weight: 600;
                    color: #333;
                    margin-bottom: 8px;
                    font-size: 16px;
                }
                .day-punches {
                    font-size: 14px;
                    color: #666;
                    margin-left: 15px;
                }
                .day-punches div {
                    margin: 5px 0;
                }
                .print-footer {
                    margin-top: 30px;
                    padding-top: 15px;
                    border-top: 1px solid #ddd;
                    text-align: center;
                    color: #666;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1>Time Clock Report</h1>
                <p><strong>Employee:</strong> ${selectedEmployee === 'All Employees' ? 'All Employees' : selectedEmployee}</p>
                <p><strong>Date Range:</strong> ${formatDateForPrint(startDate)} - ${formatDateForPrint(endDate)}</p>
                <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
            </div>
            ${reportHTML}
            <div class="print-footer">
                <p>Generated by Time Clock System</p>
            </div>
        </body>
        </html>
    `;
    
    printWindow.document.write(printHTML);
    printWindow.document.close();
    
    // Wait for content to load, then print
    printWindow.onload = function() {
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
    };
}

function emailReport() {
    const startDate = document.getElementById('report-start-date')?.value;
    const endDate = document.getElementById('report-end-date')?.value;
    if (!startDate || !endDate) {
        showMessage('Please generate a report first (select dates and click Generate Report).', 'error');
        return;
    }
    document.getElementById('email-report-to').value = '';
    document.getElementById('email-report-message').textContent = '';
    document.getElementById('email-report-modal').classList.remove('hidden');
}

function closeEmailReportModal() {
    document.getElementById('email-report-modal').classList.add('hidden');
    document.getElementById('email-report-form').reset();
    document.getElementById('email-report-message').textContent = '';
}

function handleEmailReportSubmit(e) {
    e.preventDefault();
    const to = document.getElementById('email-report-to').value.trim();
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;
    const employeeIdEl = document.getElementById('report-employee');
    const employeeId = employeeIdEl?.value?.trim() || '';

    if (!to) {
        document.getElementById('email-report-message').textContent = 'Please enter an email address.';
        document.getElementById('email-report-message').style.color = 'red';
        return;
    }
    if (!startDate || !endDate) {
        document.getElementById('email-report-message').textContent = 'Please generate a report first.';
        document.getElementById('email-report-message').style.color = 'red';
        return;
    }

    const msgEl = document.getElementById('email-report-message');
    msgEl.textContent = 'Sending...';
    msgEl.style.color = '#666';

    const body = { to, start_date: startDate, end_date: endDate };
    if (employeeId) body.employee_id = employeeId;

    fetch(`${API_BASE}/reports/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim().startsWith('{')) {
                    data = JSON.parse(text);
                } else {
                    data = { error: 'Server returned an error. Check the server is running and email (SMTP) is configured in .env.' };
                }
            } catch (_) {
                data = { error: 'Server returned an error. Check the server is running and email (SMTP) is configured in .env.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                msgEl.textContent = 'Report sent successfully.';
                msgEl.style.color = 'green';
                showMessage('Report sent by email.', 'success');
                setTimeout(() => closeEmailReportModal(), 1500);
            } else {
                msgEl.textContent = data.error || 'Failed to send email.';
                msgEl.style.color = 'red';
            }
        })
        .catch((err) => {
            msgEl.textContent = err.message || 'Failed to send email.';
            msgEl.style.color = 'red';
        });
}

function formatDateForPrint(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getFirstName(fullName) {
    if (!fullName) return 'Employee';
    // Split by space and take the first part
    const nameParts = fullName.trim().split(/\s+/);
    return nameParts[0] || 'Employee';
}

function switchTab(tabName) {
    if (!tabName) return;
    const tabContent = document.getElementById(`${tabName}-tab`);
    if (!tabContent) return;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    tabContent.classList.add('active');
    
    // Load company settings when switching to that tab
    if (tabName === 'company-settings' && (currentUser?.role === 'manager' || currentUser?.role === 'super-admin')) {
        loadCompanySettings();
    }
    // Load manager profile when switching to My Account
    if (tabName === 'my-account' && (currentUser?.role === 'manager' || currentUser?.role === 'super-admin')) {
        loadManagerProfile();
    }
    // Refresh employee list when switching to Manual Punch
    if (tabName === 'punches') {
        loadEmployeesForPunch();
    }
}

function loadCompanySettings() {
    fetch(`${API_BASE}/company-settings`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            const companyNameInput = document.getElementById('company-name');
            if (companyNameInput) companyNameInput.value = data.company_name || 'MVC';
            const logoData = data.logo_data || '';
            const preview = document.getElementById('company-logo-preview');
            const wrap = document.getElementById('company-logo-preview-wrap');
            const dataEl = document.getElementById('company-logo-data');
            if (dataEl) dataEl.value = logoData;
            if (logoData) {
                if (preview) preview.src = logoData;
                if (wrap) wrap.classList.remove('hidden');
            } else {
                if (preview) preview.src = '';
                if (wrap) wrap.classList.add('hidden');
            }
        })
        .catch(err => {
            console.error('Error loading company settings:', err);
        });
}

function loadManagerProfile() {
    const msgEl = document.getElementById('manager-profile-message');
    const emailMsgEl = document.getElementById('email-setup-message');
    fetch(`${API_BASE}/profile`, { credentials: 'include' })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim().startsWith('{')) data = JSON.parse(text);
                else data = { error: 'Server returned an unexpected response.' };
            } catch (_) {
                data = { error: 'Server returned an unexpected response. Check that the server is running.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (data.error) {
                msgEl.textContent = data.error;
                msgEl.style.color = 'red';
                return;
            }
            if (data.id || data.username) {
                document.getElementById('profile-username').value = data.username || '';
                document.getElementById('profile-name').value = data.name || '';
                document.getElementById('profile-email').value = data.email || '';
                document.getElementById('profile-ext').value = data.ext || '';
                document.getElementById('profile-new-password').value = '';
                document.getElementById('profile-confirm-password').value = '';
                document.getElementById('profile-display-name').value = data.displayName || '';
                document.getElementById('profile-smtp-user').value = data.smtpUser || '';
                document.getElementById('profile-smtp-password').value = data.smtpPassword || '';
                document.getElementById('profile-smtp-host').value = data.smtpHost || '';
                document.getElementById('profile-smtp-port').value = data.smtpPort !== '' && data.smtpPort != null ? data.smtpPort : '';
                document.getElementById('profile-smtp-secure').checked = !!data.smtpSecure;
                document.getElementById('profile-default-email-body').value = data.defaultEmailBody || '';
                msgEl.textContent = '';
                if (emailMsgEl) emailMsgEl.textContent = '';
            }
        })
        .catch(err => {
            console.error('Error loading profile:', err);
            msgEl.textContent = err.message || 'Could not load profile.';
            msgEl.style.color = 'red';
        });
}

function handleSendTestEmail() {
    const to = document.getElementById('test-email-to')?.value?.trim();
    const msgEl = document.getElementById('email-setup-message');
    if (!msgEl) return;
    if (!to) {
        msgEl.textContent = 'Enter an email address in the To field.';
        msgEl.style.color = 'red';
        return;
    }
    msgEl.textContent = 'Sending test email...';
    msgEl.style.color = '#666';
    fetch(`${API_BASE}/profile/test-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                const trimmed = text.trim();
                if (trimmed) data = JSON.parse(trimmed);
            } catch (_) {
                data = { error: 'Server returned an unexpected response. Restart the server and try again, or check the server terminal for errors.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                msgEl.textContent = 'Test email sent.';
                msgEl.style.color = 'green';
            } else {
                msgEl.textContent = data.error || 'Failed to send test email.';
                msgEl.style.color = 'red';
            }
        })
        .catch(err => {
            msgEl.textContent = err.message || 'Failed to send test email.';
            msgEl.style.color = 'red';
        });
}

function handleManagerProfileSubmit(e) {
    e.preventDefault();
    const msgEl = document.getElementById('manager-profile-message');
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const ext = document.getElementById('profile-ext').value.trim();
    const newPassword = document.getElementById('profile-new-password').value;
    const confirmPassword = document.getElementById('profile-confirm-password').value;

    if (newPassword && newPassword !== confirmPassword) {
        msgEl.textContent = 'New password and confirm password do not match.';
        msgEl.style.color = 'red';
        return;
    }

    msgEl.textContent = 'Saving...';
    msgEl.style.color = '#666';

    const body = { name, email, ext };
    if (newPassword && newPassword.trim()) body.newPassword = newPassword.trim();
    body.displayName = document.getElementById('profile-display-name')?.value?.trim() || '';
    body.smtpUser = document.getElementById('profile-smtp-user')?.value?.trim() || '';
    body.smtpHost = document.getElementById('profile-smtp-host')?.value?.trim() || '';
    const portVal = document.getElementById('profile-smtp-port')?.value;
    body.smtpPort = portVal !== '' && portVal != null ? parseInt(portVal, 10) : null;
    body.smtpSecure = document.getElementById('profile-smtp-secure')?.checked || false;
    body.defaultEmailBody = document.getElementById('profile-default-email-body')?.value?.trim() || '';
    const smtpPassword = document.getElementById('profile-smtp-password')?.value?.trim();
    if (smtpPassword) body.smtpPassword = smtpPassword;

    fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim().startsWith('{')) data = JSON.parse(text);
                else data = { error: 'Server returned an unexpected response.' };
            } catch (_) {
                data = { error: 'Server returned an unexpected response. Check that the server is running.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                msgEl.textContent = 'Profile updated successfully.';
                msgEl.style.color = 'green';
                if (currentUser) {
                    currentUser.name = name || null;
                    currentUser.email = email || null;
                    currentUser.ext = ext || null;
                }
                document.getElementById('profile-new-password').value = '';
                document.getElementById('profile-confirm-password').value = '';
                document.getElementById('profile-smtp-password').value = data.smtpPassword || '';
                loadManagerProfile();
            } else {
                msgEl.textContent = data.error || 'Failed to update profile.';
                msgEl.style.color = 'red';
            }
        })
        .catch(err => {
            msgEl.textContent = err.message || 'Failed to update profile.';
            msgEl.style.color = 'red';
        });
}

function handleCompanySettings(e) {
    e.preventDefault();
    const companyName = document.getElementById('company-name').value.trim();
    const logoData = document.getElementById('company-logo-data')?.value?.trim() || '';
    const messageDiv = document.getElementById('company-settings-message');
    if (!companyName) {
        if (messageDiv) messageDiv.innerHTML = '<p style="color: red;">Company name is required</p>';
        return;
    }
    fetch(`${API_BASE}/company-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: companyName, logo_data: logoData || null }),
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                if (messageDiv) messageDiv.innerHTML = '<p style="color: green;">Company settings saved successfully! The login page and dashboard will update.</p>';
                updateLoginPageTitle(data.company_name);
                loadManagerNavCompanyName();
            } else {
                if (messageDiv) messageDiv.innerHTML = `<p style="color: red;">${data.error || 'Failed to save settings'}</p>`;
            }
        })
        .catch(err => {
            console.error('Error saving company settings:', err);
            if (messageDiv) messageDiv.innerHTML = '<p style="color: red;">Error saving settings. Please try again.</p>';
        });
}

function updateLoginPageTitle(companyName) {
    const loginTitle = document.querySelector('#login-page h1');
    const pageTitle = document.querySelector('title');
    
    if (loginTitle) {
        loginTitle.textContent = `${companyName} Time Clock`;
    }
    if (pageTitle) {
        pageTitle.textContent = `${companyName} Time Clock`;
    }
}

function loadEmployeeNotes() {
    if (currentUser?.role !== 'manager' && currentUser?.role !== 'super-admin') return;
    
    fetch(`${API_BASE}/notes`, {
        credentials: 'include',
        method: 'GET'
    })
        .then(async res => {
            if (!res.ok) {
                const error = await res.json().catch(() => ({ error: 'Failed to load notes' }));
                throw error;
            }
            return res.json();
        })
        .then(data => {
            displayEmployeeNotes(data);
        })
        .catch(err => {
            console.error('Error loading notes:', err);
            const container = document.getElementById('employee-notes-list');
            if (container) {
                container.innerHTML = '<p style="color: red;">Error loading notes: ' + (err.error || err.message || 'Unknown error') + '</p>';
            }
        });
}

function displayEmployeeNotes(notes) {
    const container = document.getElementById('employee-notes-list');
    
    if (!notes || notes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No employee notes yet.</p>';
        return;
    }
    
    container.innerHTML = notes.map(note => {
        const date = new Date(note.created_at);
        const isUnread = note.read_status === 0;
        const employeeInfo = note.employee_name 
            ? `${note.employee_name} (${note.employee_number || ''})`
            : `Employee #${note.employee_id}`;
        
        return `
            <div class="note-card" style="background: ${isUnread ? '#fff3cd' : 'white'}; border-left: 4px solid ${isUnread ? '#ffc107' : '#667eea'};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                        <strong>${employeeInfo}</strong>
                        <div style="color: #666; font-size: 14px; margin-top: 5px;">
                            ${formatDateTime(date)}
                            ${isUnread ? '<span style="background: #ffc107; color: #333; padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-left: 10px;">New</span>' : ''}
                        </div>
                    </div>
                    ${isUnread ? `<button class="btn btn-sm" onclick="markNoteRead(${note.id})" style="padding: 5px 15px; font-size: 14px;">Mark Read</button>` : ''}
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${note.note_text}</div>
            </div>
        `;
    }).join('');
}

function markNoteRead(noteId) {
    fetch(`${API_BASE}/notes/${noteId}/read`, {
        method: 'PUT',
        credentials: 'include'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadEmployeeNotes();
        }
    })
    .catch(err => {
        console.error('Error marking note as read:', err);
    });
}

// Make markNoteRead available globally
window.markNoteRead = markNoteRead;

// Utility Functions
function formatPunchType(type) {
    return type.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
}

function showMessage(message, type = 'success') {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.remove('hidden');
    
    setTimeout(() => {
        messageDiv.classList.add('hidden');
    }, 5000);
}

function showGreatDayModal(employeeName) {
    const modal = document.getElementById('great-day-modal');
    const nameSpan = document.getElementById('great-day-name');
    if (modal) {
        if (nameSpan && employeeName) {
            nameSpan.textContent = employeeName;
        }
        modal.classList.remove('hidden');
    }
}

function closeGreatDayModal() {
    const modal = document.getElementById('great-day-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showLunchModal(employeeName) {
    const modal = document.getElementById('lunch-modal');
    const nameSpan = document.getElementById('lunch-name');
    if (modal) {
        if (nameSpan && employeeName) {
            nameSpan.textContent = employeeName;
        }
        modal.classList.remove('hidden');
    }
}

function closeLunchModal() {
    const modal = document.getElementById('lunch-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showWelcomeBackModal(employeeName) {
    const modal = document.getElementById('welcome-back-modal');
    const nameSpan = document.getElementById('welcome-back-name');
    if (modal) {
        if (nameSpan && employeeName) {
            nameSpan.textContent = employeeName;
        }
        modal.classList.remove('hidden');
    }
}

function closeWelcomeBackModal() {
    const modal = document.getElementById('welcome-back-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showClockOutModal(employeeName) {
    const modal = document.getElementById('clock-out-modal');
    const nameSpan = document.getElementById('clock-out-name');
    if (modal) {
        if (nameSpan && employeeName) {
            nameSpan.textContent = employeeName;
        }
        modal.classList.remove('hidden');
    }
}

function closeClockOutModal() {
    const modal = document.getElementById('clock-out-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Make popup functions available globally
window.closeGreatDayModal = closeGreatDayModal;
window.closeLunchModal = closeLunchModal;
window.closeWelcomeBackModal = closeWelcomeBackModal;
window.closeClockOutModal = closeClockOutModal;

// Make removeEmployee and editEmployee available globally
window.removeEmployee = removeEmployee;
window.editEmployee = editEmployee;
window.editPunch = editPunch;
window.deletePunch = deletePunch;
window.editPunch = editPunch;
window.deletePunch = deletePunch;

