// API base URL
const API_BASE = '/api';

// State
let currentUser = null;
let employees = [];
let currentWeekStart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Don't check auth immediately - let user see login page first
    // checkAuth will run after a short delay to avoid conflicts
    setTimeout(() => {
        checkAuth();
    }, 100);
    setupEventListeners();
    initializeWeekStart();
    loadEmployeesForLogin();
});

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

function showPage(role) {
    document.getElementById('login-page').classList.add('hidden');
    if (role === 'manager') {
        document.getElementById('manager-page').classList.remove('hidden');
        loadEmployees();
        loadEmployeesForPunch();
        loadEmployeesForReport();
        loadEmployeesForEditPunches();
    } else {
        document.getElementById('employee-page').classList.remove('hidden');
        updateEmployeeNameDisplay();
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
    // Login
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('manager-logout-btn')?.addEventListener('click', handleLogout);
    
    // Employee punches
    document.getElementById('clock-in-btn')?.addEventListener('click', () => handlePunch('clock_in'));
    document.getElementById('clock-out-btn')?.addEventListener('click', () => handlePunch('clock_out'));
    document.getElementById('lunch-in-btn')?.addEventListener('click', () => handlePunch('lunch_out'));
    document.getElementById('lunch-out-btn')?.addEventListener('click', () => handlePunch('lunch_in'));
    
    // Manager tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
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
    
    // Edit Punches
    document.getElementById('load-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    document.getElementById('refresh-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    
    // Edit Punches
    document.getElementById('load-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    document.getElementById('refresh-punches-btn')?.addEventListener('click', loadPunchesForEdit);
}

function loadEmployeesForLogin() {
    fetch(`${API_BASE}/employees/public`)
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('user-select');
            if (select) {
                // Keep the admin option and add employees
                const employeeOptions = data.map(emp => 
                    `<option value="emp_${emp.id}">${emp.name}</option>`
                ).join('');
                select.innerHTML = '<option value="">-- Select Name --</option>' + 
                    '<option value="admin">Admin (Manager)</option>' + 
                    employeeOptions;
            }
        })
        .catch(err => {
            console.error('Error loading employees:', err);
        });
}

function handleLogin(e) {
    e.preventDefault();
    const selectedValue = document.getElementById('user-select').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    
    if (!selectedValue) {
        errorDiv.textContent = 'Please select a name';
        return;
    }
    
    let loginData;
    
    // Check if admin or employee
    if (selectedValue === 'admin') {
        // Manager login with username
        loginData = { username: 'admin', password };
    } else {
        // Employee login with employee_id
        const employeeId = selectedValue.replace('emp_', '');
        loginData = { employee_id: parseInt(employeeId), password };
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
        if (data.success) {
            currentUser = data.user;
            showPage(data.user.role);
            loadInitialData();
            document.getElementById('login-form').reset();
            errorDiv.textContent = '';
        } else {
            errorDiv.textContent = data.error || 'Invalid password';
        }
    })
    .catch(err => {
        console.error('Login error:', err);
        errorDiv.textContent = err.message || 'Login failed. Please try again.';
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
            // Show popup for clock in, lunch in, lunch out, and clock out
            if (punchType === 'clock_in') {
                showGreatDayModal();
            } else if (punchType === 'lunch_in') {
                showWelcomeBackModal();
            } else if (punchType === 'lunch_out') {
                showLunchModal();
            } else if (punchType === 'clock_out') {
                showClockOutModal();
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
        });
}

function updatePunchButtonStates(records) {
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const lunchInBtn = document.getElementById('lunch-in-btn');
    const lunchOutBtn = document.getElementById('lunch-out-btn');
    
    if (!clockInBtn || !clockOutBtn || !lunchInBtn || !lunchOutBtn) return;
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
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
        // Filter records for today only
        const todayRecords = records.filter(record => {
            const recordDate = new Date(record.punch_time);
            const recordDateStr = recordDate.toISOString().split('T')[0];
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
    if (currentUser?.role === 'manager') {
        loadEmployees();
        loadEmployeesForPunch();
        loadEmployeesForReport();
    }
}

function loadEmployees() {
    fetch(`${API_BASE}/employees`, {
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
    const container = document.getElementById('employees-list');
    if (employeesList.length === 0) {
        container.innerHTML = '<p>No employees found. Add your first employee!</p>';
        return;
    }
    
    container.innerHTML = employeesList.map(emp => `
        <div class="employee-card">
            <div class="employee-info">
                <h4>${emp.name}</h4>
                <p>Employee #: ${emp.employee_number}${emp.email ? ` | Email: ${emp.email}` : ''}${emp.phone ? ` | Phone: ${emp.phone}` : ''}</p>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-primary" onclick="editEmployee(${emp.id})">Edit</button>
                <button class="btn btn-danger" onclick="removeEmployee(${emp.id})">Remove</button>
            </div>
        </div>
    `).join('');
}

function loadEmployeesForPunch() {
    fetch(`${API_BASE}/employees`, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('punch-employee');
            select.innerHTML = data.map(emp => 
                `<option value="${emp.id}">${emp.name} (${emp.employee_number})</option>`
            ).join('');
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
                    <button class="btn btn-primary" onclick="editPunch(${punch.id})">Edit</button>
                    <button class="btn btn-danger" onclick="deletePunch(${punch.id})">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function editPunch(id) {
    showMessage('Edit punch functionality coming soon!', 'error');
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
    // Find the employee data
    const employee = employees.find(emp => emp.id === id);
    if (!employee) {
        showMessage('Employee not found', 'error');
        return;
    }
    
    // Populate the edit form
    document.getElementById('edit-emp-id').value = employee.id;
    document.getElementById('edit-emp-name').value = employee.name || '';
    document.getElementById('edit-emp-number').value = employee.employee_number || '';
    document.getElementById('edit-emp-phone').value = formatPhoneNumber(employee.phone || '');
    document.getElementById('edit-emp-password').value = '';
    
    // Show the modal
    document.getElementById('edit-employee-modal').classList.remove('hidden');
}

function handleEditEmployee(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-emp-id').value);
    const employee = {
        name: document.getElementById('edit-emp-name').value,
        employee_number: document.getElementById('edit-emp-number').value,
        phone: document.getElementById('edit-emp-phone').value
    };
    const newPassword = document.getElementById('edit-emp-password').value.trim();
    
    // Update employee info
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
        
        if (!res.ok) {
            throw new Error(data.error || 'Failed to update employee');
        }
        
        return data;
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        if (data.success) {
            // If password was provided, update it
            if (newPassword) {
                return fetch(`${API_BASE}/employees/${id}/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: newPassword }),
                    credentials: 'include'
                })
                .then(async res => {
                    const contentType = res.headers.get('content-type');
                    let pwdData;
                    if (contentType && contentType.includes('application/json')) {
                        pwdData = await res.json();
                    } else {
                        const text = await res.text();
                        throw new Error(text || 'Server error');
                    }
                    
                    if (!res.ok) {
                        throw new Error(pwdData.error || 'Failed to change password');
                    }
                    
                    return pwdData;
                })
                .then(pwdData => {
                    if (pwdData.success) {
                        showMessage('Employee updated successfully, password changed', 'success');
                    } else {
                        showMessage('Employee updated but password change failed: ' + (pwdData.error || 'Unknown error'), 'error');
                    }
                    // Close modal and refresh after password update attempt
                    document.getElementById('edit-employee-modal').classList.add('hidden');
                    document.getElementById('edit-employee-form').reset();
                    loadEmployees();
                    loadEmployeesForPunch();
                    loadEmployeesForReport();
                })
                .catch(err => {
                    showMessage('Employee updated but password change failed: ' + (err.message || err), 'error');
                    // Close modal and refresh even if password update fails
                    document.getElementById('edit-employee-modal').classList.add('hidden');
                    document.getElementById('edit-employee-form').reset();
                    loadEmployees();
                    loadEmployeesForPunch();
                    loadEmployeesForReport();
                });
            } else {
                showMessage('Employee updated successfully', 'success');
                // Close modal and refresh
                document.getElementById('edit-employee-modal').classList.add('hidden');
                document.getElementById('edit-employee-form').reset();
                loadEmployees();
                loadEmployeesForPunch();
                loadEmployeesForReport();
            }
        } else {
            showMessage(data.error || 'Failed to update employee', 'error');
        }
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
                loadEmployees();
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
    const employee = {
        name: document.getElementById('emp-name').value,
        employee_number: document.getElementById('emp-number').value,
        email: document.getElementById('emp-email').value,
        phone: document.getElementById('emp-phone').value
    };
    
    fetch(`${API_BASE}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee),
        credentials: 'include'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showMessage('Employee added successfully! Default password: password123', 'success');
            document.getElementById('add-employee-modal').classList.add('hidden');
            document.getElementById('add-employee-form').reset();
            loadEmployees();
            loadEmployeesForPunch();
            loadEmployeesForReport();
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
    const punch = {
        employee_id: parseInt(document.getElementById('punch-employee').value),
        punch_type: document.getElementById('punch-type').value,
        notes: document.getElementById('punch-notes').value.trim() || null
    };
    
    fetch(`${API_BASE}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(punch),
        credentials: 'include'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showMessage('Punch recorded successfully!', 'success');
            document.getElementById('manual-punch-form').reset();
        } else {
            showMessage(data.error || 'Failed to record punch', 'error');
        }
    })
    .catch(err => {
        showMessage('Error recording punch', 'error');
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
        .then(res => res.json())
        .then(data => {
            displayReport(data);
        })
        .catch(err => {
            showMessage('Error generating report', 'error');
        });
}

function displayReport(reportData) {
    const container = document.getElementById('report-results');
    
    if (reportData.length === 0) {
        container.innerHTML = '<p>No records found for the selected date range.</p>';
        return;
    }
    
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

function switchTab(tabName) {
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
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

function loadEmployeeNotes() {
    if (currentUser?.role !== 'manager') return;
    
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

function showGreatDayModal() {
    const modal = document.getElementById('great-day-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeGreatDayModal() {
    const modal = document.getElementById('great-day-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showLunchModal() {
    const modal = document.getElementById('lunch-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeLunchModal() {
    const modal = document.getElementById('lunch-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showWelcomeBackModal() {
    const modal = document.getElementById('welcome-back-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeWelcomeBackModal() {
    const modal = document.getElementById('welcome-back-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showClockOutModal() {
    const modal = document.getElementById('clock-out-modal');
    if (modal) {
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

