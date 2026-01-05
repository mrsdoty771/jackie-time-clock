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
    document.getElementById('report-week').value = monday.toISOString().split('T')[0];
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
        loadEmployeeNotes();
    } else {
        document.getElementById('employee-page').classList.remove('hidden');
        updateEmployeeNameDisplay();
        loadEmployeeRecords();
    }
}

function updateEmployeeNameDisplay() {
    // If we have employee_name, use it
    if (currentUser.employee_name) {
        document.getElementById('employee-name').textContent = currentUser.employee_name;
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
                        document.getElementById('employee-name').textContent = employee.name;
                        currentUser.employee_name = employee.name;
                    } else {
                        document.getElementById('employee-name').textContent = 'Employee';
                    }
                } else {
                    document.getElementById('employee-name').textContent = 'Employee';
                }
            })
            .catch(() => {
                document.getElementById('employee-name').textContent = 'Employee';
            });
    } else {
        document.getElementById('employee-name').textContent = 'Employee';
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
    document.getElementById('lunch-in-btn')?.addEventListener('click', () => handlePunch('lunch_in'));
    document.getElementById('lunch-out-btn')?.addEventListener('click', () => handlePunch('lunch_out'));
    
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
    
    // Manual punch
    document.getElementById('manual-punch-form')?.addEventListener('submit', handleManualPunch);
    
    // Reports
    document.getElementById('generate-report-btn')?.addEventListener('click', generateReport);
    
    // Notes
    document.getElementById('refresh-notes-btn')?.addEventListener('click', loadEmployeeNotes);
}

function loadEmployeesForLogin() {
    fetch(`${API_BASE}/employees/public`)
        .then(res => res.json())
        .then(data => {
            const select = document.getElementById('user-select');
            if (select) {
                // Keep the admin option and add employees
                const employeeOptions = data.map(emp => 
                    `<option value="emp_${emp.id}">${emp.name} (${emp.employee_number})</option>`
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
            showMessage('Punch recorded successfully!', 'success');
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
        })
        .catch(err => {
            console.error('Error loading records:', err);
        });
}

function displayEmployeeRecords(records) {
    const container = document.getElementById('employee-records');
    if (records.length === 0) {
        container.innerHTML = '<p>No records found.</p>';
        return;
    }
    
    container.innerHTML = records.slice(0, 20).map(record => {
        const date = new Date(record.punch_time);
        const typeClass = record.punch_type.replace('_', '-');
        const hasNotes = record.notes && record.notes.trim().length > 0;
        return `
            <div class="record-item">
                <div>
                    <span class="record-type ${typeClass}">${formatPunchType(record.punch_type)}</span>
                    <span style="margin-left: 15px;">${formatDateTime(date)}</span>
                    ${hasNotes ? `<div style="margin-top: 5px; padding: 8px; background: #f8f9fa; border-left: 3px solid #667eea; font-size: 13px; color: #555;"><strong>Note:</strong> ${record.notes.replace(/\n/g, '<br>')}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
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
                <p>Employee #: ${emp.employee_number}${emp.email ? ` | Email: ${emp.email}` : ''}</p>
            </div>
            <button class="btn btn-danger" onclick="removeEmployee(${emp.id})">Remove</button>
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
    const weekStart = document.getElementById('report-week').value;
    
    let url = `${API_BASE}/reports/weekly?week_start=${weekStart}`;
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
        container.innerHTML = '<p>No records found for this week.</p>';
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
    
    // Load notes when notes tab is opened
    if (tabName === 'notes') {
        loadEmployeeNotes();
    }
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

// Make removeEmployee available globally
window.removeEmployee = removeEmployee;

