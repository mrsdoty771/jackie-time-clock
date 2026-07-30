// API base URL
const API_BASE = '/api';

/** MVC Time Clock login uses this company only (no Company ID field on the login form). */
const LOGIN_COMPANY_ID = 'MVC';

// State
let currentUser = null;
let employees = [];
let currentWeekStart = null;
let lastReportData = null;
/** Company timezone (IANA, e.g. America/New_York). Set after login via loadCompanyTimezone(). */
let companyTimezone = 'UTC';
/** Pay week boundaries (0=Sun … 6=Sat, same as Date.getDay()). Defaults Monday–Sunday. */
let companyPayWeekStartDay = 1;
let companyPayWeekEndDay = 0;
/** When super-admin has no linked employee, My Clock uses this company "Admin" employee id for punches and listing. */
let myClockAdminEmployeeId = null;
/** Employee-page time-history filter state. */
let employeeHistoryRangeMode = 'this_week';
/** Manager Reports date-range filter state. */
let reportRangeMode = 'this_week';
/** Context for forgotten clock-out modal (employee or manager self-punch). */
let missingClockOutContext = null;

// Intercept API 403 PASSWORD_RESET_REQUIRED so the app can show forced password change UI
const _originalFetch = window.fetch;
window.fetch = function (url) {
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    const isApi = urlStr.indexOf(API_BASE) !== -1;
    return _originalFetch.apply(this, arguments).then(function (res) {
        if (isApi && res.status === 403) {
            return res.clone().json().then(function (data) {
                if (data && data.code === 'PASSWORD_RESET_REQUIRED') {
                    fetch(`${API_BASE}/me`, { credentials: 'include' })
                        .then(function (r) { return r.json(); })
                        .then(function (d) {
                            if (d && d.user) currentUser = d.user;
                            showForcedPasswordChangeUI();
                        })
                        .catch(function () { showForcedPasswordChangeUI(); });
                }
                return res;
            }).catch(function () {
                return res;
            });
        }
        return res;
    });
};

// Initialize (run when DOM is ready; if app.js loads late, DOMContentLoaded may have already fired)
function init() {
    registerServiceWorker();
    initPwaInstall();
    initWindowControlsOverlay();
    maybeSetDefaultDesktopAppWindowSize();
    loadCompanyNameForLogin();
    setTimeout(() => {
        const wantInstall = consumeInstallQueryFlag();
        redeemPasswordResetFromUrl().then((resetHandled) => {
            if (resetHandled) {
                if (wantInstall) maybeShowInstallPrompt(true);
                return;
            }
            redeemLoginInviteFromUrl().then((handled) => {
                if (!handled) checkAuth();
                // Home Screen SMS (?install=1): show instructions now.
                // Login-invite SMS: wait until after they sign in / set password (see showPage).
                if (wantInstall && !handled) maybeShowInstallPrompt(true);
            });
        });
    }, 100);
    setupEventListeners();
    initializeWeekStart();
}

// ---------------------------------------------------------------------------
// PWA: installable app + remembered device login
// ---------------------------------------------------------------------------

const SAVED_LOGIN_KEY = 'tc_saved_login';
const INSTALL_DISMISS_KEY = 'tc_install_dismissed';
const PENDING_INSTALL_KEY = 'tc_pending_install';
let deferredInstallPrompt = null;
let pendingHomeScreenPrompt = false;

function markPendingHomeScreenPrompt() {
    pendingHomeScreenPrompt = true;
    try { localStorage.setItem(PENDING_INSTALL_KEY, '1'); } catch (_) {}
    try { sessionStorage.setItem(PENDING_INSTALL_KEY, '1'); } catch (_) {}
}

function consumePendingHomeScreenPrompt() {
    let pending = pendingHomeScreenPrompt;
    try {
        if (localStorage.getItem(PENDING_INSTALL_KEY) === '1') pending = true;
        localStorage.removeItem(PENDING_INSTALL_KEY);
    } catch (_) {}
    try {
        if (sessionStorage.getItem(PENDING_INSTALL_KEY) === '1') pending = true;
        sessionStorage.removeItem(PENDING_INSTALL_KEY);
    } catch (_) {}
    pendingHomeScreenPrompt = false;
    return pending;
}

function showHomeScreenPromptWhenReady(force) {
    // Wait a tick so the employee page is visible and timezone load can finish.
    setTimeout(() => maybeShowInstallPrompt(!!force), 400);
}

function consumeInstallQueryFlag() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('install') !== '1' && params.get('app') !== '1') return false;
        params.delete('install');
        params.delete('app');
        const qs = params.toString();
        const next = window.location.pathname + (qs ? `?${qs}` : '') + (window.location.hash || '');
        window.history.replaceState({}, document.title, next);
        return true;
    } catch (_) {
        return false;
    }
}

function initWindowControlsOverlay() {
    const titlebar = document.getElementById('app-titlebar');
    const sync = () => {
        const wco = navigator.windowControlsOverlay;
        const visible = !!(wco && wco.visible);
        document.body.classList.toggle('has-window-controls-overlay', visible);
        if (titlebar) titlebar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    };
    sync();
    try {
        navigator.windowControlsOverlay?.addEventListener('geometrychange', sync);
    } catch (_) {}
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            // Pick up new SW (cache bumps) so Home Screen users get UI updates like password eyes.
            reg.update().catch(() => {});
        }).catch((err) => {
            console.log('Service worker registration failed:', err);
        });
    });
}

function isRunningAsInstalledApp() {
    return (
        window.matchMedia && (
            window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: window-controls-overlay)').matches
        )
    ) || window.navigator.standalone === true;
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

/**
 * Best-effort default size for the installed desktop app window.
 * Browsers may block resizeTo; Chrome often remembers the last size after the user closes the app.
 */
function maybeSetDefaultDesktopAppWindowSize() {
    try {
        if (!isRunningAsInstalledApp()) return;
        if (isIosDevice()) return;
        if (/Android/i.test(navigator.userAgent || '')) return;

        const PREFERRED_W = 920;
        const PREFERRED_H = 740;
        const KEY = 'tc_desktop_window_default_v1';

        // Only apply once per profile so we don't fight a size the user prefers later.
        if (localStorage.getItem(KEY) === '1') return;

        const tooWide = window.outerWidth > PREFERRED_W + 100;
        const tooTall = window.outerHeight > PREFERRED_H + 100;
        // Skip if already close to preferred (or smaller on a small monitor).
        if (!tooWide && !tooTall) {
            localStorage.setItem(KEY, '1');
            return;
        }

        if (typeof window.resizeTo !== 'function') return;

        const w = Math.min(PREFERRED_W, screen.availWidth || PREFERRED_W);
        const h = Math.min(PREFERRED_H, screen.availHeight || PREFERRED_H);
        window.resizeTo(w, h);

        if (typeof window.moveTo === 'function') {
            const left = Math.max(0, Math.round(((screen.availWidth || w) - w) / 2));
            const top = Math.max(0, Math.round(((screen.availHeight || h) - h) / 2));
            window.moveTo(left, top);
        }

        localStorage.setItem(KEY, '1');
    } catch (_) {
        // Browsers may block window resizing; ignore.
    }
}

/** Remember this employee's login on THIS device so the home-screen icon opens ready to clock in. */
function saveDeviceLogin(username, password) {
    try {
        if (!username || !password) return;
        localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({ username, password }));
    } catch (_) {}
}

function getDeviceLogin() {
    try {
        const raw = localStorage.getItem(SAVED_LOGIN_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.username && parsed.password) return parsed;
    } catch (_) {}
    return null;
}

function clearDeviceLogin() {
    try { localStorage.removeItem(SAVED_LOGIN_KEY); } catch (_) {}
}

/** Try logging in silently with credentials saved on this device (returns true if it logged in). */
function attemptSilentLogin() {
    const creds = getDeviceLogin();
    if (!creds) return Promise.resolve(false);
    return fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: creds.username, password: creds.password, companyId: getLoginCompanyId() }),
        credentials: 'include',
    })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
            if (data && data.success) {
                currentUser = data.user;
                if (data.must_change_password || currentUser.must_change_password) {
                    markPendingHomeScreenPrompt();
                    showForcedPasswordChangeUI();
                    return true;
                }
                showPage(data.user.role);
                loadInitialData();
                return true;
            }
            // Saved password no longer works (e.g. it was changed) — forget it.
            clearDeviceLogin();
            return false;
        })
        .catch(() => false);
}

function hideInstallModal() {
    document.getElementById('install-app-modal')?.classList.add('hidden');
}

function initPwaInstall() {
    const installBtn = document.getElementById('install-app-btn');
    const laterBtn = document.getElementById('install-app-later');
    const doneBtn = document.getElementById('install-app-done');
    const androidSteps = document.getElementById('install-modal-android');
    const iosSteps = document.getElementById('install-modal-ios');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        // Optional one-tap for Chrome — steps stay the main path (Samsung "Downloading" is confusing).
        if (!isIosDevice()) installBtn?.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        hideInstallModal();
        try { localStorage.setItem(INSTALL_DISMISS_KEY, 'installed'); } catch (_) {}
    });

    installBtn?.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        installBtn.classList.add('hidden');
        if (choice && choice.outcome === 'accepted') hideInstallModal();
    });

    const dismiss = () => {
        try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (_) {}
        hideInstallModal();
    };
    doneBtn?.addEventListener('click', dismiss);
    laterBtn?.addEventListener('click', dismiss);
}

/** Show Home Screen instructions. Pass force=true right after opening the SMS link. */
function maybeShowInstallPrompt(force) {
    if (isRunningAsInstalledApp()) return;
    const modal = document.getElementById('install-app-modal');
    if (!modal) return;

    if (!force) {
        try {
            const v = localStorage.getItem(INSTALL_DISMISS_KEY);
            if (v === 'installed') return;
            if (v && Date.now() - Number(v) < 3 * 24 * 60 * 60 * 1000) return;
        } catch (_) {}
    }

    const androidSteps = document.getElementById('install-modal-android');
    const iosSteps = document.getElementById('install-modal-ios');
    const quickAdd = document.getElementById('install-app-btn');
    if (isIosDevice()) {
        androidSteps?.classList.add('hidden');
        iosSteps?.classList.remove('hidden');
        quickAdd?.classList.add('hidden');
    } else {
        iosSteps?.classList.add('hidden');
        androidSteps?.classList.remove('hidden');
        if (deferredInstallPrompt) quickAdd?.classList.remove('hidden');
        else quickAdd?.classList.add('hidden');
    }
    modal.classList.remove('hidden');
}

/** SMS login link: /?invite=token — fetch credentials once to pre-fill login; user must sign in manually. */
async function redeemLoginInviteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return false;

    // New-hire SMS link — always offer Home Screen after they get in (even if invite redeem fails
    // and they type the username/password from the text, or switch from Messages to Chrome).
    markPendingHomeScreenPrompt();

    window.history.replaceState({}, document.title, window.location.pathname);

    const errorDiv = document.getElementById('login-error');
    try {
        const res = await fetch(`${API_BASE}/login-invite/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        showLoginPage();
        if (!res.ok || data.error) {
            if (errorDiv) {
                errorDiv.textContent = data.error || 'This login link is invalid or has expired.';
                errorDiv.style.color = 'red';
            }
            return true;
        }

        const idEl = document.getElementById('login-identifier');
        const pwdEl = document.getElementById('password');
        if (idEl) idEl.value = data.username || '';
        if (pwdEl) pwdEl.value = data.password || '';
        if (errorDiv) errorDiv.textContent = '';
        // Remember this login on the device so the home-screen icon opens ready to clock in.
        saveDeviceLogin(data.username, data.password);
        return true;
    } catch (err) {
        console.error('Login invite error:', err);
        showLoginPage();
        if (errorDiv) {
            errorDiv.textContent = 'Could not open login link. Try again or enter credentials manually.';
            errorDiv.style.color = 'red';
        }
        return true;
    }
}

/** Manager SMS reset link: /?reset=token — open set-new-password form (no temp password in the text). */
let pendingPasswordResetToken = null;
let pendingPasswordResetUsername = '';

async function redeemPasswordResetFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (!token) return false;

    window.history.replaceState({}, document.title, window.location.pathname);

    const errorDiv = document.getElementById('login-error');
    try {
        const res = await fetch(`${API_BASE}/password-reset/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            showLoginPage();
            if (errorDiv) {
                errorDiv.textContent = data.error || 'This reset link is invalid or has expired.';
                errorDiv.style.color = 'red';
            }
            return true;
        }

        pendingPasswordResetToken = token;
        pendingPasswordResetUsername = data.username || '';
        if (data.companyId) {
            try {
                const companyInput = document.getElementById('login-company-id');
                if (companyInput && !companyInput.value) companyInput.value = data.companyId;
            } catch (_) {}
        }
        const idEl = document.getElementById('login-identifier');
        if (idEl) idEl.value = pendingPasswordResetUsername;
        showForcedPasswordChangeUI({
            fromResetLink: true,
            username: pendingPasswordResetUsername,
        });
        return true;
    } catch (err) {
        console.error('Password reset link error:', err);
        showLoginPage();
        if (errorDiv) {
            errorDiv.textContent = 'Could not open reset link. Ask your manager to send a new one.';
            errorDiv.style.color = 'red';
        }
        return true;
    }
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
    return LOGIN_COMPANY_ID;
}

/** Day of week 0–6 (Sun–Sat) for a date in the company (or given) timezone. */
function getLocalDayOfWeekInTz(date, timezone) {
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(date));
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? 0;
}

/** Pay-week start/end as YYYY-MM-DD in company timezone. weekOffset 0 = current week, -1 = previous. */
function getPayWeekLocalDateRangeInTz(weekOffset = 0) {
    const weekStart = typeof companyPayWeekStartDay === 'number' && !Number.isNaN(companyPayWeekStartDay)
        ? companyPayWeekStartDay
        : 1;
    const zone = companyTimezone || 'UTC';
    const todayStr = getLocalDateStringInTz(new Date(), zone);
    const ref = instantOnLocalDate(todayStr, zone);
    const day = getLocalDayOfWeekInTz(ref, zone);
    const diff = (day - weekStart + 7) % 7;
    const startMs = ref.getTime() - diff * 24 * 60 * 60 * 1000 + weekOffset * 7 * 24 * 60 * 60 * 1000;
    const endMs = startMs + 6 * 24 * 60 * 60 * 1000;
    return {
        startDate: getLocalDateStringInTz(new Date(startMs), zone),
        endDate: getLocalDateStringInTz(new Date(endMs), zone),
    };
}

/** Start date of the pay week containing `date`, for a week that begins on weekStartDay (0–6). */
function getWeekStartDateForDate(date, weekStartDay) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = (day - weekStartDay + 7) % 7;
    d.setDate(d.getDate() - diff);
    return d;
}

function initializeWeekStart() {
    const { startDate, endDate } = getPayWeekLocalDateRangeInTz(0);
    setDateInputValue('report-start-date', startDate);
    setDateInputValue('report-end-date', endDate);
    updateReportRangeLabel({ startDate, endDate, label: 'This Week' });
}

function getReportRangeSelection() {
    if (reportRangeMode === 'last_week') {
        const range = getPayWeekLocalDateRangeInTz(-1);
        return { ...range, label: 'Last Week' };
    }

    if (reportRangeMode === 'custom') {
        const startDate = document.getElementById('report-start-date')?.value || '';
        const endDate = document.getElementById('report-end-date')?.value || '';
        if (!startDate || !endDate || startDate > endDate) return null;
        return { startDate, endDate, label: 'Custom Dates' };
    }

    const range = getPayWeekLocalDateRangeInTz(0);
    return { ...range, label: 'This Week' };
}

function updateReportRangeLabel(range) {
    const labelEl = document.getElementById('report-range-current');
    if (!labelEl || !range) return;
    labelEl.textContent = `Showing: ${range.label} (${range.startDate} to ${range.endDate})`;
}

function applyReportRangeToInputs(range) {
    if (!range) return;
    setDateInputValue('report-start-date', range.startDate);
    setDateInputValue('report-end-date', range.endDate);
}

function syncPayWeekEndFromStart() {
    const sel = document.getElementById('pay-week-start');
    const endSel = document.getElementById('pay-week-end');
    if (!sel || !endSel) return;
    const start = parseInt(sel.value, 10);
    if (Number.isNaN(start)) return;
    endSel.value = String((start + 6) % 7);
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
                if (data.user.must_change_password) {
                    showForcedPasswordChangeUI();
                } else {
                    showPage(data.user.role);
                    loadInitialData();
                }
            } else {
                // No active session — try the login saved on this device (installed app / returning phone).
                attemptSilentLogin().then((ok) => { if (!ok) showLoginPage(); });
            }
        })
        .catch((err) => {
            console.log('Auth check failed (this is normal if not logged in):', err);
            showLoginPage();
        });
}

function hideForcedPasswordChangeUI() {
    document.getElementById('forced-password-section')?.classList.add('hidden');
    document.getElementById('standard-login-flow')?.classList.remove('hidden');
    const forcedMsg = document.getElementById('forced-password-message');
    if (forcedMsg) forcedMsg.textContent = '';
    const userHint = document.getElementById('forced-password-username');
    if (userHint) {
        userHint.textContent = '';
        userHint.classList.add('hidden');
    }
    const intro = document.getElementById('forced-password-intro');
    if (intro) {
        intro.textContent = 'For security, you must choose a new password before using the time clock.';
    }
}

function showForcedPasswordChangeUI(opts) {
    const fromResetLink = !!(opts && opts.fromResetLink);
    const username = (opts && opts.username) || '';
    document.getElementById('employee-page')?.classList.add('hidden');
    document.getElementById('manager-page')?.classList.add('hidden');
    document.getElementById('login-page')?.classList.remove('hidden');
    document.getElementById('standard-login-flow')?.classList.add('hidden');
    document.getElementById('forced-password-section')?.classList.remove('hidden');
    const err = document.getElementById('login-error');
    if (err) err.textContent = '';
    const intro = document.getElementById('forced-password-intro');
    if (intro) {
        intro.textContent = fromResetLink
            ? 'Choose a new password for your Time Clock login.'
            : 'For security, you must choose a new password before using the time clock.';
    }
    const userHint = document.getElementById('forced-password-username');
    if (userHint) {
        if (username) {
            userHint.textContent = `Username: ${username}`;
            userHint.classList.remove('hidden');
        } else {
            userHint.textContent = '';
            userHint.classList.add('hidden');
        }
    }
    const form = document.getElementById('forced-password-form');
    form?.reset();
}

function showLoginPage() {
    hideForcedPasswordChangeUI();
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

function updateManagerNavTitle() {
    const el = document.getElementById('manager-nav-title');
    if (!el) return;
    const name = (currentUser?.name || currentUser?.employee_name || currentUser?.username || '').trim();
    el.textContent = name ? `Manager Dashboard - ${name}` : 'Manager Dashboard';
}

function applyCompanyPayWeekFromSettings(data) {
    if (!data) return;
    const s = data.pay_week_start_day;
    const e = data.pay_week_end_day;
    const start = s !== undefined && s !== null && !Number.isNaN(parseInt(s, 10))
        ? parseInt(s, 10)
        : 1;
    const end = e !== undefined && e !== null && !Number.isNaN(parseInt(e, 10))
        ? parseInt(e, 10)
        : (start + 6) % 7;
    companyPayWeekStartDay = start;
    companyPayWeekEndDay = end;
    const ps = document.getElementById('pay-week-start');
    const pe = document.getElementById('pay-week-end');
    if (ps) ps.value = String(start);
    if (pe) pe.value = String(end);
}

function loadCompanyTimezone() {
    return fetch(`${API_BASE}/company-settings`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const tz = (data && data.timezone && String(data.timezone).trim()) ? data.timezone : 'UTC';
            companyTimezone = tz;
            applyCompanyPayWeekFromSettings(data);
            initializeWeekStart();
            setManualPunchDefaultsToCompanyNow();
            return companyTimezone;
        })
        .catch(() => {
            companyTimezone = 'UTC';
            companyPayWeekStartDay = 1;
            companyPayWeekEndDay = 0;
            initializeWeekStart();
            return companyTimezone;
        });
}

function refreshTimezoneDependentViews() {
    initializeWeekStart();
    setManualPunchDefaultsToCompanyNow();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset?.tab;
    if (activeTab === 'edit-punches') loadPunchesForEdit();
    if (currentUser?.role === 'employee') {
        loadEmployeeRecords();
    }
    if (activeTab === 'my-clock') loadMyClockPunches();
}

function showPage(role) {
    hideForcedPasswordChangeUI();
    document.getElementById('login-page').classList.add('hidden');
    loadCompanyTimezone().then(() => {
        if (role === 'manager' || role === 'super-admin') {
            document.getElementById('manager-page').classList.remove('hidden');
            switchTab('punches');
            loadManagerNavCompanyName();
            updateManagerNavTitle();
            loadEmployees();
            loadEmployeesForPunch();
            loadEmployeesForReport();
            loadEmployeesForEditPunches();
        } else {
            document.getElementById('employee-page').classList.remove('hidden');
            updateEmployeePageTitle();
            updateEmployeeNameDisplay();
            updatePunchButtonStates([]);
            loadEmployeeRecords();
        }
        // After a new-hire invite / first password change: show Home Screen tips.
        // Otherwise gently nudge employees still using the browser.
        if (consumePendingHomeScreenPrompt()) showHomeScreenPromptWhenReady(true);
        else if (role === 'employee') showHomeScreenPromptWhenReady(false);
    });
}

function updateEmployeeNameDisplay() {
    // If we have employee_name, use it
    if (currentUser.employee_name) {
        document.getElementById('employee-name').textContent = 'Hello, ' + currentUser.employee_name;
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
                        document.getElementById('employee-name').textContent = 'Hello, ' + employee.name;
                        currentUser.employee_name = employee.name;
                    } else {
                        document.getElementById('employee-name').textContent = 'Hello, Employee';
                    }
                } else {
                    document.getElementById('employee-name').textContent = 'Hello, Employee';
                }
            })
            .catch(() => {
                document.getElementById('employee-name').textContent = 'Hello, Employee';
            });
    } else {
        document.getElementById('employee-name').textContent = 'Hello, Employee';
    }
}

function openEmployeeProfileModal() {
    const modal = document.getElementById('employee-profile-modal');
    const msgEl = document.getElementById('employee-profile-message');
    if (!modal) return;
    if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '';
    }
    document.getElementById('employee-profile-new-password').value = '';
    document.getElementById('employee-profile-confirm-password').value = '';
    loadEmployeeProfileForm();
    modal.classList.remove('hidden');
}

function closeEmployeeProfileModal() {
    document.getElementById('employee-profile-modal')?.classList.add('hidden');
    document.getElementById('employee-profile-form')?.reset();
    const msgEl = document.getElementById('employee-profile-message');
    if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '';
    }
}

function loadEmployeeProfileForm() {
    const phoneEl = document.getElementById('employee-profile-phone');
    const msgEl = document.getElementById('employee-profile-message');
    if (!phoneEl) return;
    if (msgEl) {
        msgEl.textContent = 'Loading...';
        msgEl.style.color = '#666';
    }
    fetch(`${API_BASE}/profile`, { credentials: 'include' })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim().startsWith('{')) data = JSON.parse(text);
                else data = { error: 'Server returned an unexpected response.' };
            } catch (_) {
                data = { error: 'Server returned an unexpected response.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (!ok || data.error) {
                phoneEl.value = '';
                if (msgEl) {
                    msgEl.textContent = data.error || 'Could not load profile.';
                    msgEl.style.color = 'red';
                }
                return;
            }
            phoneEl.value = formatPhoneNumber(data.phone || '');
            if (msgEl) {
                msgEl.textContent = '';
                msgEl.style.color = '';
            }
        })
        .catch((err) => {
            if (msgEl) {
                msgEl.textContent = err.message || 'Could not load profile.';
                msgEl.style.color = 'red';
            }
        });
}

function handleEmployeeProfileSubmit(e) {
    e.preventDefault();
    const msgEl = document.getElementById('employee-profile-message');
    const phone = document.getElementById('employee-profile-phone')?.value?.trim() || '';
    const newPassword = document.getElementById('employee-profile-new-password')?.value || '';
    const confirmPassword = document.getElementById('employee-profile-confirm-password')?.value || '';

    if (newPassword && newPassword !== confirmPassword) {
        msgEl.textContent = 'New password and confirm password do not match.';
        msgEl.style.color = 'red';
        return;
    }
    if (newPassword && newPassword.trim().length < 6) {
        msgEl.textContent = 'Password must be at least 6 characters.';
        msgEl.style.color = 'red';
        return;
    }

    msgEl.textContent = 'Saving...';
    msgEl.style.color = '#666';

    const body = { phone };
    if (newPassword && newPassword.trim()) body.newPassword = newPassword.trim();

    fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim().startsWith('{')) data = JSON.parse(text);
                else data = { error: 'Server returned an unexpected response.' };
            } catch (_) {
                data = { error: 'Server returned an unexpected response.' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                if (data.phone !== undefined) {
                    document.getElementById('employee-profile-phone').value = formatPhoneNumber(data.phone || '');
                }
                msgEl.textContent = 'Profile updated successfully.';
                msgEl.style.color = 'green';
                document.getElementById('employee-profile-new-password').value = '';
                document.getElementById('employee-profile-confirm-password').value = '';
                if (currentUser) currentUser.must_change_password = false;
                setTimeout(closeEmployeeProfileModal, 1200);
            } else {
                msgEl.textContent = data.error || 'Failed to update profile.';
                msgEl.style.color = 'red';
            }
        })
        .catch((err) => {
            msgEl.textContent = err.message || 'Failed to update profile.';
            msgEl.style.color = 'red';
        });
}

/** Open native date picker when clicking anywhere in the field (not only the calendar icon). */
function bindDateInputFullClick(inputEl) {
    if (!inputEl || inputEl.type !== 'date') return;
    inputEl.addEventListener('click', () => {
        if (typeof inputEl.showPicker !== 'function') return;
        try {
            inputEl.showPicker();
        } catch (_) {
            // showPicker must run from a user gesture; ignore if the browser blocks it.
        }
    });
}

function bindPunchDateInputsFullClick() {
    ['edit-punch-date'].forEach((id) => {
        bindDateInputFullClick(document.getElementById(id));
    });
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
    document.getElementById('forced-password-form')?.addEventListener('submit', handleForcedPasswordSubmit);
    document.getElementById('forced-new-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('forced-new-password', 'forced-new-password-toggle');
    });
    document.getElementById('forced-confirm-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('forced-confirm-password', 'forced-confirm-password-toggle');
    });
    // Forgot password: show forgot form, hide login password + button
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-password-row')?.classList.add('hidden');
        document.getElementById('login-submit-btn')?.classList.add('hidden');
        document.getElementById('forgot-password-link-wrap')?.classList.add('hidden');
        document.getElementById('forgot-password-section')?.classList.remove('hidden');
        document.getElementById('login-error').textContent = '';
        document.getElementById('forgot-password-message').textContent = '';
    });
    // Back to login
    document.getElementById('back-to-login-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-password-row')?.classList.remove('hidden');
        document.getElementById('login-submit-btn')?.classList.remove('hidden');
        document.getElementById('forgot-password-link-wrap')?.classList.remove('hidden');
        document.getElementById('forgot-password-section')?.classList.add('hidden');
        document.getElementById('forgot-password-message').textContent = '';
        document.getElementById('forgot-password-form')?.reset();
    });
    document.getElementById('forgot-password-form')?.addEventListener('submit', handleForgotPasswordSubmit);
    // Eye toggles for forgot-password form
    document.getElementById('forgot-new-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('forgot-new-password', 'forgot-new-password-toggle');
    });
    document.getElementById('forgot-confirm-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('forgot-confirm-password', 'forgot-confirm-password-toggle');
    });
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('manager-logout-btn')?.addEventListener('click', handleLogout);

    // Employee profile (phone + password)
    document.getElementById('employee-profile-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        openEmployeeProfileModal();
    });
    document.getElementById('employee-profile-form')?.addEventListener('submit', handleEmployeeProfileSubmit);
    document.querySelector('.close-employee-profile')?.addEventListener('click', closeEmployeeProfileModal);
    document.getElementById('employee-profile-new-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('employee-profile-new-password', 'employee-profile-new-password-toggle');
    });
    document.getElementById('employee-profile-confirm-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        togglePasswordVisibility('employee-profile-confirm-password', 'employee-profile-confirm-password-toggle');
    });
    const employeeProfilePhoneInput = document.getElementById('employee-profile-phone');
    if (employeeProfilePhoneInput) {
        employeeProfilePhoneInput.addEventListener('input', function (e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 10) value = value.slice(0, 10);
            if (value.length >= 6) {
                value = value.slice(0, 3) + '-' + value.slice(3, 6) + '-' + value.slice(6);
            } else if (value.length >= 3) {
                value = value.slice(0, 3) + '-' + value.slice(3);
            }
            e.target.value = value;
        });
    }
    
    // Employee punches
    document.getElementById('clock-in-btn')?.addEventListener('click', () => handlePunch('clock_in'));
    document.getElementById('clock-out-btn')?.addEventListener('click', () => handlePunch('clock_out'));
    document.getElementById('lunch-in-btn')?.addEventListener('click', () => handlePunch('lunch_out'));
    document.getElementById('lunch-out-btn')?.addEventListener('click', () => handlePunch('lunch_in'));
    document.getElementById('employee-history-toggle-btn')?.addEventListener('click', () => {
        document.getElementById('employee-history-panel')?.classList.toggle('hidden');
    });
    document.getElementById('employee-history-range')?.addEventListener('change', (e) => {
        const mode = e.target?.value || 'this_week';
        employeeHistoryRangeMode = mode;
        const customWrap = document.getElementById('employee-history-custom-dates');
        if (customWrap) customWrap.classList.toggle('hidden', mode !== 'custom');
        if (mode === 'custom') {
            const startEl = document.getElementById('employee-history-start-date');
            const endEl = document.getElementById('employee-history-end-date');
            const current = getPayWeekLocalDateRangeInTz(0);
            if (startEl && !startEl.value) setDateInputValue('employee-history-start-date', current.startDate);
            if (endEl && !endEl.value) setDateInputValue('employee-history-end-date', current.endDate);
            syncDateInputUi('employee-history-start-date');
            syncDateInputUi('employee-history-end-date');
        }
    });
    document.getElementById('employee-history-apply-btn')?.addEventListener('click', () => {
        loadEmployeeRecords();
    });
    document.getElementById('employee-records-print-btn')?.addEventListener('click', printEmployeeRecords);
    document.getElementById('missing-clock-out-form')?.addEventListener('submit', handleMissingClockOutSubmit);
    document.getElementById('cancel-missing-clock-out-btn')?.addEventListener('click', closeMissingClockOutModal);
    document.getElementById('close-missing-clock-out-btn')?.addEventListener('click', closeMissingClockOutModal);
    document.getElementById('pending-corrections-list')?.addEventListener('click', (e) => {
        const approveBtn = e.target.closest('[data-approve-pending]');
        const rejectBtn = e.target.closest('[data-reject-pending]');
        const resolveBtn = e.target.closest('[data-resolve-missing]');
        if (approveBtn) {
            reviewPendingCorrection(approveBtn.dataset.approvePending, 'approve', approveBtn.dataset.date || '');
        } else if (rejectBtn) {
            if (confirm('Reject and remove this employee-reported clock-out? The shift will be open again until fixed.')) {
                reviewPendingCorrection(rejectBtn.dataset.rejectPending, 'reject');
            }
        } else if (resolveBtn) {
            resolveMissingClockOutFromManager(
                resolveBtn.dataset.employeeId || '',
                resolveBtn.dataset.date || '',
                resolveBtn.dataset.resolveMissing || ''
            );
        }
    });
    
    // Manager tabs — use currentTarget so clicking the label/text still switches the tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.currentTarget.dataset.tab;
            if (tab) switchTab(tab);
        });
    });
    document.getElementById('manager-my-clock-btn')?.addEventListener('click', () => switchTab('my-clock'));
    
    // Employee management — Add Employee modal
    document.getElementById('add-employee-btn')?.addEventListener('click', openAddEmployeeModal);
    document.getElementById('add-employee-form')?.addEventListener('submit', handleAddEmployee);
    document.getElementById('add-employee-submit-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleAddEmployee(e);
    });
    document.getElementById('cancel-add-btn')?.addEventListener('click', closeAddEmployeeModal);
    document.getElementById('close-add-employee-btn')?.addEventListener('click', closeAddEmployeeModal);
    document.getElementById('add-employee-done-btn')?.addEventListener('click', closeAddEmployeeModal);
    document.getElementById('add-employee-copy-credentials-btn')?.addEventListener('click', copyAddEmployeeCredentials);
    document.getElementById('add-employee-send-login-text-btn')?.addEventListener('click', sendAddEmployeeLoginText);
    document.getElementById('edit-employee-send-app-link-btn')?.addEventListener('click', () => sendEditEmployeeText('app'));
    document.getElementById('edit-employee-send-login-text-btn')?.addEventListener('click', () => sendEditEmployeeText('reset'));

    // Grant manager rights modal
    document.getElementById('confirm-grant-manager-btn')?.addEventListener('click', handleConfirmGrantManager);
    document.getElementById('cancel-grant-manager-btn')?.addEventListener('click', () => document.getElementById('grant-manager-modal')?.classList.add('hidden'));
    document.querySelector('.close-grant-manager')?.addEventListener('click', () => document.getElementById('grant-manager-modal')?.classList.add('hidden'));

    // Edit employee modal
    document.getElementById('edit-employee-form')?.addEventListener('submit', handleEditEmployee);
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
        document.getElementById('edit-employee-modal').classList.add('hidden');
        document.getElementById('edit-employee-form').reset();
        editEmpUsernameManuallyEdited = false;
        editEmpMustChangePassword = false;
        editEmpStoredPassword = '';
        editEmpHasStoredPassword = false;
        setEditEmployeeSendLoginMessage('', false);
    });
    
    document.querySelector('.close-edit')?.addEventListener('click', () => {
        document.getElementById('edit-employee-modal').classList.add('hidden');
        editEmpUsernameManuallyEdited = false;
        editEmpMustChangePassword = false;
        editEmpStoredPassword = '';
        editEmpHasStoredPassword = false;
        setEditEmployeeSendLoginMessage('', false);
    });

    document.getElementById('edit-emp-username-suggest')?.addEventListener('click', () => {
        const nameVal = document.getElementById('edit-emp-name')?.value || '';
        const u = suggestedLoginUsernameFromFullName(nameVal);
        const input = document.getElementById('edit-emp-username');
        if (input && u) {
            suppressEditUsernameInputEvent = true;
            input.value = u;
            suppressEditUsernameInputEvent = false;
            editEmpUsernameManuallyEdited = true;
        } else if (!u) {
            showMessage('Enter a name with a first and last name to generate a username.', 'error');
        }
    });

    document.getElementById('edit-emp-username')?.addEventListener('input', () => {
        if (!suppressEditUsernameInputEvent) editEmpUsernameManuallyEdited = true;
    });

    document.getElementById('edit-emp-name')?.addEventListener('input', () => {
        maybeSyncEditUsernameFromName();
    });

    document.getElementById('edit-emp-password-toggle')?.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    document.getElementById('edit-emp-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleEditEmpPasswordVisibility();
    });
    document.getElementById('edit-emp-generate-password')?.addEventListener('click', handleEditEmpGeneratePassword);

    document.getElementById('terminate-employee-form')?.addEventListener('submit', handleTerminateEmployeeSubmit);
    document.getElementById('cancel-terminate-employee-btn')?.addEventListener('click', () => {
        document.getElementById('terminate-employee-modal')?.classList.add('hidden');
        document.getElementById('terminate-employee-form')?.reset();
    });
    document.querySelector('.close-terminate-employee')?.addEventListener('click', () => {
        document.getElementById('terminate-employee-modal')?.classList.add('hidden');
        document.getElementById('terminate-employee-form')?.reset();
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
            updateEditEmployeeSendLoginTextButton(e.target.value);
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
    
    // My Clock (manager self punch)
    document.getElementById('my-clock-in-btn')?.addEventListener('click', () => handleManagerPunch('clock_in'));
    document.getElementById('my-clock-out-btn')?.addEventListener('click', () => handleManagerPunch('clock_out'));
    document.getElementById('my-lunch-in-btn')?.addEventListener('click', () => handleManagerPunch('lunch_out'));
    document.getElementById('my-lunch-out-btn')?.addEventListener('click', () => handleManagerPunch('lunch_in'));
    // Manual punch
    document.getElementById('manual-punch-form')?.addEventListener('submit', handleManualPunch);
    initAllCustomDatePickers();
    setManualPunchDefaultsToCompanyNow();
    bindPunchDateInputsFullClick();

    // Reports
    document.getElementById('generate-report-btn')?.addEventListener('click', generateReport);
    document.getElementById('report-range')?.addEventListener('change', (e) => {
        const mode = e.target?.value || 'this_week';
        reportRangeMode = mode;
        const customWrap = document.getElementById('report-custom-dates');
        if (customWrap) customWrap.classList.toggle('hidden', mode !== 'custom');
        if (mode === 'custom') {
            const current = getPayWeekLocalDateRangeInTz(0);
            const rs = document.getElementById('report-start-date');
            const re = document.getElementById('report-end-date');
            if (rs && !rs.value) setDateInputValue('report-start-date', current.startDate);
            if (re && !re.value) setDateInputValue('report-end-date', current.endDate);
            syncDateInputUi('report-start-date');
            syncDateInputUi('report-end-date');
        }
        const preview = getReportRangeSelection();
        if (preview) updateReportRangeLabel(preview);
    });
    const syncReportCustomPreview = () => {
        if (reportRangeMode !== 'custom') return;
        const preview = getReportRangeSelection();
        if (preview) updateReportRangeLabel(preview);
    };
    document.getElementById('report-start-date')?.addEventListener('change', syncReportCustomPreview);
    document.getElementById('report-end-date')?.addEventListener('change', syncReportCustomPreview);
    document.getElementById('print-report-btn')?.addEventListener('click', printReport);
    document.getElementById('email-report-btn')?.addEventListener('click', emailReport);
    
    // Edit Punches
    document.getElementById('load-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    document.getElementById('refresh-punches-btn')?.addEventListener('click', loadPunchesForEdit);
    // Auto-load punches when both employee + date are selected
    const editEmpEl = document.getElementById('edit-punches-employee');
    const editDateEl = document.getElementById('edit-punches-date');
    const editListEl = document.getElementById('edit-punches-list');
    let editPunchesAutoLoadTimer = null;
    const maybeAutoLoadEditPunches = () => {
        const employeeId = editEmpEl?.value || '';
        const date = editDateEl?.value || '';
        if (!employeeId || !date) {
            if (editListEl) editListEl.innerHTML = '<p style="color:#666;">Select an <strong>Employee</strong> and a <strong>Date</strong> to view existing punches.</p>';
            return;
        }
        // Debounce quick changes (employee/date/time fields)
        if (editPunchesAutoLoadTimer) clearTimeout(editPunchesAutoLoadTimer);
        editPunchesAutoLoadTimer = setTimeout(() => {
            loadPunchesForEdit();
        }, 150);
    };
    editEmpEl?.addEventListener('change', maybeAutoLoadEditPunches);
    editDateEl?.addEventListener('change', maybeAutoLoadEditPunches);
    document.getElementById('edit-punch-form')?.addEventListener('submit', handleEditPunchSubmit);
    document.querySelector('.close-edit-punch')?.addEventListener('click', () => document.getElementById('edit-punch-modal')?.classList.add('hidden'));
    
    // Company Settings
    document.getElementById('company-settings-form')?.addEventListener('submit', handleCompanySettings);
    document.getElementById('pay-week-start')?.addEventListener('change', syncPayWeekEndFromStart);
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

    // Login page: eye toggles password visibility
    document.getElementById('login-password-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('password');
        const btn = document.getElementById('login-password-toggle');
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

    document.getElementById('company-twilio-auth-token-toggle')?.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('company-twilio-auth-token');
        const btn = document.getElementById('company-twilio-auth-token-toggle');
        const showIcon = btn?.querySelector('.pwd-icon-show');
        const hideIcon = btn?.querySelector('.pwd-icon-hide');
        if (!input || !btn) return;
        const revealed = input.classList.toggle('secret-revealed');
        btn.setAttribute('aria-label', revealed ? 'Hide auth token' : 'Show auth token');
        btn.setAttribute('title', revealed ? 'Hide auth token' : 'Show auth token');
        if (showIcon) showIcon.style.display = revealed ? 'none' : '';
        if (hideIcon) hideIcon.style.display = revealed ? '' : 'none';
    });

    document.getElementById('company-notify-recipient-add')?.addEventListener('click', (e) => {
        e.preventDefault();
        addNotifyRecipientRow();
    });

    document.getElementById('company-notify-recipients-rows')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.notify-recipient-delete');
        if (!btn) return;
        e.preventDefault();
        btn.closest('.notify-recipient-row')?.remove();
        updateNotifyRecipientsEmptyState();
    });

    setupEditPasswordPlaceholder();
    
    // Employee Status Filter
    document.getElementById('employee-status-filter')?.addEventListener('change', (e) => {
        const status = e.target.value;
        loadEmployees(status);
    });

    // Employee Management dropdown: show selected employee details
    document.getElementById('employee-management-select')?.addEventListener('change', updateEmployeeManagementDetails);

    // Role toggle: only update visual state; Save button applies the change
    document.getElementById('employee-management-details')?.addEventListener('click', function (e) {
        const seg = e.target.closest('.role-segmented');
        if (!seg) return;
        const btn = e.target.closest('.role-seg-opt');
        if (!btn || btn.disabled) return;
        if (btn.classList.contains('active')) return; // already selected, no-op
        seg.querySelectorAll('.role-seg-opt').forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
    });
    // Save role (Employee/Manager) from card
    document.getElementById('employee-management-details')?.addEventListener('click', function (e) {
        const saveBtn = e.target.closest('.btn-save-role');
        if (!saveBtn) return;
        e.preventDefault();
        const card = saveBtn.closest('.employee-card');
        if (!card) return;
        const seg = card.querySelector('.role-segmented');
        if (!seg) return;
        const employeeId = seg.getAttribute('data-employee-id');
        const activeBtn = seg.querySelector('.role-seg-opt.active');
        if (!employeeId || !activeBtn) return;
        const isManager = activeBtn.getAttribute('data-role') === 'manager';
        setEmployeeRoleFromCard(employeeId, isManager, seg);
    });

    // Email Report modal
    document.getElementById('email-report-form')?.addEventListener('submit', handleEmailReportSubmit);
    document.getElementById('cancel-email-report-btn')?.addEventListener('click', closeEmailReportModal);
    document.querySelector('.close-email-report')?.addEventListener('click', closeEmailReportModal);
}

function togglePasswordVisibility(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    const showIcon = btn?.querySelector('.pwd-icon-show');
    const hideIcon = btn?.querySelector('.pwd-icon-hide');
    if (!input || !btn) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    btn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
    if (showIcon) showIcon.style.display = isPassword ? 'none' : '';
    if (hideIcon) hideIcon.style.display = isPassword ? '' : 'none';
}

function handleForcedPasswordSubmit(e) {
    e.preventDefault();
    const newPassword = document.getElementById('forced-new-password').value;
    const confirmPassword = document.getElementById('forced-confirm-password').value;
    const msgEl = document.getElementById('forced-password-message');

    if (!newPassword || newPassword.length < 6) {
        msgEl.textContent = 'Password must be at least 6 characters.';
        msgEl.style.color = 'red';
        return;
    }
    if (newPassword !== confirmPassword) {
        msgEl.textContent = 'Passwords do not match.';
        msgEl.style.color = 'red';
        return;
    }

    msgEl.textContent = '';

    if (pendingPasswordResetToken) {
        const token = pendingPasswordResetToken;
        fetch(`${API_BASE}/password-reset/${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword, confirmPassword }),
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    msgEl.textContent = data.error || 'Could not update password.';
                    msgEl.style.color = 'red';
                    return;
                }
                pendingPasswordResetToken = null;
                const username = data.username || pendingPasswordResetUsername || '';
                pendingPasswordResetUsername = '';
                document.getElementById('forced-password-form').reset();
                showLoginPage();
                const idEl = document.getElementById('login-identifier');
                const pwdEl = document.getElementById('password');
                if (idEl) idEl.value = username;
                if (pwdEl) pwdEl.value = '';
                if (username) saveDeviceLogin(username, newPassword);
                const errorDiv = document.getElementById('login-error');
                if (errorDiv) {
                    errorDiv.textContent = 'Password saved. Sign in with your new password.';
                    errorDiv.style.color = '#2e7d32';
                }
            })
            .catch((err) => {
                msgEl.textContent = err.message || 'Something went wrong. Please try again.';
                msgEl.style.color = 'red';
            });
        return;
    }

    fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
        credentials: 'include'
    })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                msgEl.textContent = data.error || 'Could not update password.';
                msgEl.style.color = 'red';
                return;
            }
            currentUser = { ...currentUser, must_change_password: false };
            // Update the remembered device login with their newly chosen password.
            const savedUser = currentUser?.username || getDeviceLogin()?.username;
            if (savedUser) saveDeviceLogin(savedUser, newPassword);
            document.getElementById('forced-password-form').reset();
            // New hires always land here after the temp password — offer Home Screen next.
            markPendingHomeScreenPrompt();
            showPage(currentUser.role);
            loadInitialData();
            showHomeScreenPromptWhenReady(true);
        })
        .catch((err) => {
            msgEl.textContent = err.message || 'Something went wrong. Please try again.';
            msgEl.style.color = 'red';
        });
}

function handleForgotPasswordSubmit(e) {
    e.preventDefault();
    const companyId = getLoginCompanyId();
    const username = (document.getElementById('login-identifier')?.value || '').trim();
    const newPassword = document.getElementById('forgot-new-password').value;
    const confirmPassword = document.getElementById('forgot-confirm-password').value;
    const msgEl = document.getElementById('forgot-password-message');

    if (!companyId) {
        msgEl.textContent = 'Please enter your Company ID above.';
        msgEl.style.color = 'red';
        return;
    }
    if (!username) {
        msgEl.textContent = 'Please enter your username or email above.';
        msgEl.style.color = 'red';
        return;
    }
    if (!newPassword || newPassword.length < 6) {
        msgEl.textContent = 'New password must be at least 6 characters.';
        msgEl.style.color = 'red';
        return;
    }
    if (newPassword !== confirmPassword) {
        msgEl.textContent = 'Passwords do not match.';
        msgEl.style.color = 'red';
        return;
    }

    const body = { companyId, username, newPassword, confirmPassword };

    msgEl.textContent = '';
    fetch(`${API_BASE}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                // Server returned HTML — request likely didn't reach the Node API (wrong URL or app not restarted)
                msgEl.innerHTML = 'Request did not reach the server. Open the app at the same address as the server (e.g. <strong>http://localhost:3000</strong>), restart with <strong>npm start</strong>, then try again.';
                msgEl.style.color = 'red';
                return;
            }
            if (data.error && data.path === '/forgot-password') {
                msgEl.textContent = 'Forgot-password route not found. Restart the server (npm start) and try again.';
                msgEl.style.color = 'red';
                return;
            }
            if (data.success) {
                msgEl.textContent = data.message || 'Password updated. You can log in with your new password.';
                msgEl.style.color = 'green';
                document.getElementById('forgot-password-form').reset();
                setTimeout(() => {
                    document.getElementById('back-to-login-link').click();
                }, 2000);
            } else {
                msgEl.textContent = data.error || 'Something went wrong.';
                msgEl.style.color = 'red';
            }
        })
        .catch(err => {
            msgEl.textContent = err.message || 'Something went wrong. Please try again.';
            msgEl.style.color = 'red';
        });
}

function handleLogin(e) {
    e.preventDefault();
    const username = (document.getElementById('login-identifier')?.value || '').trim();
    const password = (document.getElementById('password')?.value || '').trim();
    const companyId = getLoginCompanyId();
    const errorDiv = document.getElementById('login-error');

    if (!username) {
        errorDiv.textContent = 'Please enter your username or email';
        return;
    }

    if (!companyId) {
        errorDiv.textContent = 'Please enter your Company ID';
        return;
    }

    const loginData = { username, password, companyId };

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
            // Remember this login on the device for quick day-two access from the app icon.
            saveDeviceLogin(username, password);
            if (data.must_change_password || currentUser.must_change_password) {
                document.getElementById('login-form').reset();
                errorDiv.textContent = '';
                hideInstallModal();
                // First login / temp password — show Home Screen after they choose a new password.
                markPendingHomeScreenPrompt();
                showForcedPasswordChangeUI();
                return;
            }
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
        }
    })
    .catch(err => {
        console.error('Login error:', err);
        const errMsg = err.message || 'Login failed. Please try again.';
        errorDiv.textContent = errMsg;
        errorDiv.style.color = 'red';
        errorDiv.style.fontWeight = 'bold';
    });
}

function handleLogout() {
    // Forget the saved device login so the app icon no longer auto-signs-in.
    clearDeviceLogin();
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
function openMissingClockOutModal(data, options = {}) {
    missingClockOutContext = {
        openLocalDate: data.open_local_date,
        clockInTime: data.clock_in_time,
        noteText: options.noteText || null,
        source: options.source || 'employee',
    };

    const modal = document.getElementById('missing-clock-out-modal');
    const dateEl = document.getElementById('missing-clock-out-date');
    const clockInEl = document.getElementById('missing-clock-out-clock-in');
    const timeEl = document.getElementById('missing-clock-out-time');
    const msgEl = document.getElementById('missing-clock-out-message');
    const errEl = document.getElementById('missing-clock-out-error');
    if (errEl) errEl.textContent = '';
    if (dateEl) dateEl.value = data.open_local_date || '';
    if (clockInEl) {
        clockInEl.value = data.clock_in_time ? formatTimeOnly(data.clock_in_time) : '';
    }
    if (timeEl) timeEl.value = '';
    if (msgEl) {
        const dayLabel = data.open_local_date ? formatShortDate(data.open_local_date) : 'a previous day';
        msgEl.textContent = `It looks like you forgot to clock out on ${dayLabel}. What time did you leave?`;
    }
    modal?.classList.remove('hidden');
    timeEl?.focus();
}

function closeMissingClockOutModal() {
    document.getElementById('missing-clock-out-modal')?.classList.add('hidden');
    document.getElementById('missing-clock-out-form')?.reset();
    const errEl = document.getElementById('missing-clock-out-error');
    if (errEl) errEl.textContent = '';
    missingClockOutContext = null;
}

function handleMissingClockOutSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('missing-clock-out-error');
    if (errEl) errEl.textContent = '';
    if (!missingClockOutContext?.openLocalDate) {
        if (errEl) errEl.textContent = 'Missing shift details. Close and try Clock In again.';
        return;
    }

    const timeVal = document.getElementById('missing-clock-out-time')?.value || '';
    if (!timeVal) {
        if (errEl) errEl.textContent = 'Please enter the time you left.';
        return;
    }

    const clockOutLocal = `${missingClockOutContext.openLocalDate}T${timeVal}`;
    const noteText = missingClockOutContext.noteText || null;
    const source = missingClockOutContext.source || 'employee';

    fetch(`${API_BASE}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            punch_type: 'clock_in',
            notes: noteText,
            resolve_missing_clock_out: { clock_out_time: clockOutLocal },
        }),
        credentials: 'include',
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim()) data = JSON.parse(text);
            } catch (_) {}
            return { ok: res.ok, status: res.status, data };
        })
        .then(({ ok, status, data }) => {
            if (ok && data.success) {
                closeMissingClockOutModal();
                if (source === 'manager') {
                    showMessage('Pending clock-out saved and you are clocked in. A manager should approve the correction.', 'success');
                    const noteEl = document.getElementById('my-clock-note');
                    if (noteEl) noteEl.value = '';
                    loadMyClockPunches();
                    loadPendingCorrections();
                } else {
                    const fullName = currentUser?.employee_name || currentUser?.username || 'Employee';
                    showGreatDayModal(getFirstName(fullName));
                    const noteTextarea = document.getElementById('punch-note');
                    if (noteTextarea) noteTextarea.value = '';
                    loadEmployeeRecords();
                }
            } else {
                const msg = data.error || 'Could not save clock-out and clock in.';
                if (errEl) errEl.textContent = msg;
                else showMessage(msg, 'error');
            }
        })
        .catch(() => {
            if (errEl) errEl.textContent = 'Error saving. Please try again.';
            else showMessage('Error recording punch', 'error');
        });
}

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
    .then(async (res) => {
        const text = await res.text();
        let data = {};
        try {
            if (text.trim()) data = JSON.parse(text);
        } catch (_) {}
        return { ok: res.ok, status: res.status, data };
    })
    .then(({ ok, status, data }) => {
        if (ok && data.success) {
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
        } else if (data.code === 'MISSING_CLOCK_OUT') {
            openMissingClockOutModal(data, { noteText: noteText || null, source: 'employee' });
        } else {
            if (status === 409 || data.code === 'DUPLICATE_PUNCH_TYPE_FOR_DAY') {
                showMessage(data.error || 'Duplicate punch for that day.', 'error');
            } else {
                showMessage(data.error || 'Failed to record punch', 'error');
            }
        }
    })
    .catch(err => {
        showMessage('Error recording punch', 'error');
    });
}

function formatDateInputValue(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getEmployeeHistoryRangeSelection() {
    if (employeeHistoryRangeMode === 'last_week') {
        const range = getPayWeekLocalDateRangeInTz(-1);
        return { ...range, label: 'Last Week' };
    }

    if (employeeHistoryRangeMode === 'custom') {
        const startDate = document.getElementById('employee-history-start-date')?.value || '';
        const endDate = document.getElementById('employee-history-end-date')?.value || '';
        if (!startDate || !endDate || startDate > endDate) return null;
        return { startDate, endDate, label: 'Custom Dates' };
    }

    const range = getPayWeekLocalDateRangeInTz(0);
    return { ...range, label: 'This Week' };
}

function loadEmployeeRecords() {
    const range = getEmployeeHistoryRangeSelection();
    if (!range) {
        showMessage('Please select a valid custom date range.', 'error');
        return;
    }
    const currentLabel = document.getElementById('employee-history-current');
    if (currentLabel) currentLabel.textContent = `Showing: ${range.label} (${range.startDate} to ${range.endDate})`;
    const url = `${API_BASE}/punches?start_date=${encodeURIComponent(range.startDate)}&end_date=${encodeURIComponent(range.endDate)}`;
    fetch(url, {
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

function getEmployeePunchStatusFromRecords(records) {
    const todayStr = getLocalDateStringInTz(new Date(), companyTimezone);
    const todayRecords = (records || []).filter((record) => {
        const recordDateStr = getLocalDateStringInTz(record.punch_time, companyTimezone);
        return recordDateStr === todayStr;
    });

    const hasClockIn = todayRecords.some((r) => r.punch_type === 'clock_in');
    const hasClockOut = todayRecords.some((r) => r.punch_type === 'clock_out');
    const hasLunchIn = todayRecords.some((r) => r.punch_type === 'lunch_in');
    const hasLunchOut = todayRecords.some((r) => r.punch_type === 'lunch_out');

    if (hasClockOut || !hasClockIn) {
        return { text: 'Clocked Out', statusClass: 'employee-status-clocked-out' };
    }
    if (hasLunchOut && !hasLunchIn) {
        return { text: 'On Lunch', statusClass: 'employee-status-on-lunch' };
    }
    return { text: 'Clocked In', statusClass: 'employee-status-clocked-in' };
}

function updateEmployeeStatusBar(records) {
    const bar = document.getElementById('employee-status-bar');
    const textEl = document.getElementById('employee-status-text');
    if (!bar || !textEl) return;

    const { text, statusClass } = getEmployeePunchStatusFromRecords(records);
    textEl.textContent = text;
    bar.classList.remove('employee-status-clocked-out', 'employee-status-clocked-in', 'employee-status-on-lunch');
    bar.classList.add(statusClass);
}

function updatePunchButtonStates(records) {
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const lunchInBtn = document.getElementById('lunch-in-btn');
    const lunchOutBtn = document.getElementById('lunch-out-btn');
    
    if (!clockInBtn || !clockOutBtn || !lunchInBtn || !lunchOutBtn) return;
    
    // Get today's date in company timezone (YYYY-MM-DD)
    const todayStr = getLocalDateStringInTz(new Date(), companyTimezone);

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
        // Filter records for today only (using company timezone)
        const todayRecords = records.filter(record => {
            const recordDateStr = getLocalDateStringInTz(record.punch_time, companyTimezone);
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

    updateEmployeeStatusBar(records);
}

function calculateDayWorkHours(clockIn, clockOut, lunchIn, lunchOut, asOf) {
    if (!clockIn) return 0;

    let effectiveEnd = clockOut;
    if (!effectiveEnd) {
        if (lunchOut && !lunchIn) {
            effectiveEnd = lunchOut;
        } else {
            effectiveEnd = asOf;
        }
    }

    if (effectiveEnd <= clockIn) return 0;

    let hours = (effectiveEnd - clockIn) / (1000 * 60 * 60);
    if (lunchOut && lunchIn && lunchOut < lunchIn) {
        hours -= (lunchIn - lunchOut) / (1000 * 60 * 60);
    }
    return Math.max(0, hours);
}

/** Last minute of a local calendar day in the company timezone. */
function getEndOfLocalDayInstant(localDateStr, timezone) {
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const start = instantOnLocalDate(localDateStr, zone);
    let last = start;
    for (let i = 1; i <= 24 * 60; i++) {
        const d = new Date(start.getTime() + i * 60 * 1000);
        if (getLocalDateStringInTz(d, zone) === localDateStr) last = d;
        else break;
    }
    return last;
}

function getEmployeePageDisplayName() {
    const employeeNameEl = document.getElementById('employee-name');
    if (employeeNameEl?.textContent) {
        return employeeNameEl.textContent.replace(/^Hello,\s*/i, '').trim() || 'Employee';
    }
    return currentUser?.employee_name || 'Employee';
}

/** Build manager-style timesheet data from raw punch records. */
function buildEmployeeTimesheetDataFromPunches(records, employeeName) {
    const recordsByDay = {};
    (records || []).slice(0, 100).forEach((record) => {
        const dateStr = getLocalDateStringInTz(record.punch_time, companyTimezone);
        if (!recordsByDay[dateStr]) recordsByDay[dateStr] = [];
        recordsByDay[dateStr].push(record);
    });

    const todayStr = getLocalDateStringInTz(new Date(), companyTimezone);
    const now = new Date();
    const days = {};
    let totalHours = 0;

    Object.keys(recordsByDay).forEach((dateStr) => {
        const dayRecords = recordsByDay[dateStr].sort(
            (a, b) => new Date(a.punch_time) - new Date(b.punch_time)
        );

        let clockIn = null;
        let clockOut = null;
        let lunchIn = null;
        let lunchOut = null;
        const punches = dayRecords.map((record) => {
            const punchTime = new Date(record.punch_time);
            if (record.punch_type === 'clock_in') clockIn = punchTime;
            if (record.punch_type === 'clock_out') clockOut = punchTime;
            if (record.punch_type === 'lunch_in') lunchIn = punchTime;
            if (record.punch_type === 'lunch_out') lunchOut = punchTime;
            return {
                type: record.punch_type,
                time: record.punch_time,
                notes: record.notes || null,
                approval_status: record.approval_status || 'none',
            };
        });

        const asOf = dateStr === todayStr ? now : getEndOfLocalDayInstant(dateStr, companyTimezone);
        const hours = calculateDayWorkHours(clockIn, clockOut, lunchIn, lunchOut, asOf);
        totalHours += hours;
        days[dateStr] = { date: dateStr, punches, hours };
    });

    return {
        employee_name: employeeName || 'Employee',
        days,
        total_hours: totalHours,
    };
}

function displayEmployeeRecords(records) {
    const container = document.getElementById('employee-records');
    if (!records || records.length === 0) {
        container.innerHTML = '<p>No records found.</p>';
        return;
    }

    const range = getEmployeeHistoryRangeSelection();
    const startDate = range?.startDate || '';
    const endDate = range?.endDate || '';
    const emp = buildEmployeeTimesheetDataFromPunches(records, getEmployeePageDisplayName());

    container.innerHTML = `
        <div class="timesheet-header">
            <h2 class="timesheet-title">Time Sheet</h2>
            <div class="timesheet-dates">
                <span><strong>Start Date</strong> ${formatShortDate(startDate)}</span>
                <span><strong>End Date</strong> ${formatShortDate(endDate)}</span>
            </div>
        </div>
        ${buildEmployeeTimesheet(emp)}
    `;
}

function getEmployeeTimesheetPrintStyles() {
    return `
        @media print {
            @page { margin: 1cm; }
            body { margin: 0; padding: 12px; }
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            padding: 16px;
            color: #000;
            font-size: 13px;
        }
        .timesheet-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 20px;
            border-bottom: 2px solid #000;
            padding-bottom: 8px;
        }
        .timesheet-title {
            margin: 0;
            font-size: 22px;
            font-weight: bold;
        }
        .timesheet-dates span { margin-left: 20px; }
        .timesheet-employee { margin-bottom: 24px; page-break-inside: avoid; }
        .timesheet-employee-name {
            margin: 0 0 6px;
            font-size: 15px;
            font-weight: bold;
        }
        .timesheet-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            table-layout: fixed;
        }
        .timesheet-table col.col-date { width: 78px; }
        .timesheet-table col.col-time { width: 72px; }
        .timesheet-table col.col-hours { width: 52px; }
        .timesheet-table th,
        .timesheet-table td {
            border: 1px solid #ccc;
            padding: 4px 5px;
            text-align: left;
            vertical-align: top;
        }
        .timesheet-table th:nth-child(2),
        .timesheet-table th:nth-child(3),
        .timesheet-table th:nth-child(4),
        .timesheet-table th:nth-child(5),
        .timesheet-table td:nth-child(2),
        .timesheet-table td:nth-child(3),
        .timesheet-table td:nth-child(4),
        .timesheet-table td:nth-child(5) {
            padding: 4px 2px;
            font-size: 11px;
            white-space: nowrap;
            text-align: center;
        }
        .timesheet-table th {
            background: #f5f5f5;
            font-weight: bold;
            font-size: 10px;
            white-space: nowrap;
        }
        .timesheet-table th:nth-child(6) {
            font-size: 11px;
            white-space: normal;
            text-align: center;
            line-height: 1.15;
        }
        .timesheet-hours { text-align: center; white-space: nowrap; font-size: 12px; }
        .timesheet-grand-total {
            color: #c00;
            font-weight: bold;
            text-align: center;
            font-size: 12px;
        }
        .timesheet-notes {
            font-size: 11px;
            color: #444;
            word-wrap: break-word;
            overflow-wrap: anywhere;
        }
        .timesheet-empty { text-align: center; color: #666; font-style: italic; }
        .print-footer {
            margin-top: 20px;
            padding-top: 8px;
            border-top: 1px solid #ccc;
            text-align: center;
            color: #666;
            font-size: 11px;
        }
    `;
}

function printEmployeeRecords() {
    const recordsContainer = document.getElementById('employee-records');
    if (!recordsContainer) return;

    const recordsHtml = recordsContainer.innerHTML.trim();
    if (!recordsHtml || recordsHtml.includes('No records found')) {
        showMessage('No time records to print for the selected date range.', 'error');
        return;
    }

    const employeeName = getEmployeePageDisplayName();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showMessage('Pop-up blocked. Please allow pop-ups to print your time records.', 'error');
        return;
    }

    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Time Sheet - ${escapeHtml(employeeName)}</title>
            <style>${getEmployeeTimesheetPrintStyles()}</style>
        </head>
        <body>
            ${recordsHtml}
            <div class="print-footer">
                <p>Generated ${new Date().toLocaleString()} · ${escapeHtml(employeeName)}</p>
            </div>
        </body>
        </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();

    printWindow.onload = function () {
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
    };
}

// Manager Functions
function loadInitialData() {
    if (currentUser?.role === 'manager' || currentUser?.role === 'super-admin') {
        loadMyClockState();
        loadEmployees();
        loadEmployeesForPunch();
        loadEmployeesForReport();
        loadPendingCorrections();
    }
}

function loadMyClockState() {
    const noLinkEl = document.getElementById('my-clock-no-link');
    const sectionEl = document.getElementById('my-clock-section');
    if (!noLinkEl || !sectionEl) return;
    const hasLink = !!currentUser?.employee_id;
    const isManagerNoLink = (currentUser?.role === 'manager' || currentUser?.role === 'super-admin') && !hasLink;
    if (hasLink) {
        myClockAdminEmployeeId = null;
        noLinkEl.classList.add('hidden');
        sectionEl.classList.remove('hidden');
        loadMyClockPunches();
        return;
    }
    if (isManagerNoLink) {
        myClockAdminEmployeeId = null;
        fetch(`${API_BASE}/company-admin-employee`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data && data.employee_id) {
                    myClockAdminEmployeeId = data.employee_id;
                    noLinkEl.classList.add('hidden');
                    sectionEl.classList.remove('hidden');
                    loadMyClockPunches();
                } else {
                    noLinkEl.classList.remove('hidden');
                    sectionEl.classList.add('hidden');
                }
            })
            .catch(() => {
                noLinkEl.classList.remove('hidden');
                sectionEl.classList.add('hidden');
            });
        return;
    }
    noLinkEl.classList.remove('hidden');
    sectionEl.classList.add('hidden');
}

function loadMyClockPunches() {
    const effectiveEmployeeId = currentUser?.employee_id || myClockAdminEmployeeId;
    if (!effectiveEmployeeId) return;
    const { startDate, endDate } = getPayWeekLocalDateRangeInTz(0);
    const params = new URLSearchParams({
        employee_id: effectiveEmployeeId,
        start_date: startDate,
        end_date: endDate,
    });
    const url = `${API_BASE}/punches?${params.toString()}`;
    fetch(url, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const records = Array.isArray(data) ? data : [];
            displayMyClockRecords(records);
            updateMyClockButtonStates(records);
        })
        .catch(() => {
            document.getElementById('my-clock-records').innerHTML = '<p>Could not load records.</p>';
            updateMyClockButtonStates([]);
        });
}

function updateMyClockButtonStates(records) {
    const clockInBtn = document.getElementById('my-clock-in-btn');
    const clockOutBtn = document.getElementById('my-clock-out-btn');
    const lunchInBtn = document.getElementById('my-lunch-in-btn');
    const lunchOutBtn = document.getElementById('my-lunch-out-btn');
    if (!clockInBtn || !clockOutBtn || !lunchInBtn || !lunchOutBtn) return;
    const todayStr = getLocalDateStringInTz(new Date(), companyTimezone);
    function setState(btn, disabled) {
        btn.disabled = !!disabled;
        btn.style.opacity = disabled ? '0.5' : '1';
        btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
    if (!records || records.length === 0) {
        setState(clockInBtn, false);
        setState(clockOutBtn, true);
        setState(lunchInBtn, true);
        setState(lunchOutBtn, true);
        return;
    }
    const todayRecords = records.filter(r => getLocalDateStringInTz(r.punch_time, companyTimezone) === todayStr);
    const hasClockIn = todayRecords.some(r => r.punch_type === 'clock_in');
    const hasClockOut = todayRecords.some(r => r.punch_type === 'clock_out');
    const hasLunchIn = todayRecords.some(r => r.punch_type === 'lunch_in');
    const hasLunchOut = todayRecords.some(r => r.punch_type === 'lunch_out');
    setState(clockInBtn, hasClockIn);
    setState(clockOutBtn, hasClockOut || !hasClockIn);
    setState(lunchInBtn, hasLunchOut || !hasClockIn);
    setState(lunchOutBtn, hasLunchIn || !hasLunchOut);
}

function displayMyClockRecords(records) {
    const container = document.getElementById('my-clock-records');
    if (!container) return;
    if (!records || records.length === 0) {
        container.innerHTML = '<p>No punches this week.</p>';
        return;
    }
    const slice = records.slice(0, 30);
    const html = slice.map(record => {
        const date = new Date(record.punch_time);
        const typeClass = record.punch_type.replace('_', '-');
        const pending = record.approval_status === 'pending'
            ? ' <span class="pending-flag">(Pending)</span>'
            : '';
        return `<div class="record-item" style="margin-bottom: 6px;"><span class="record-type ${typeClass}">${formatPunchType(record.punch_type)}</span> <span style="margin-left: 10px;">${formatDateTime(date)}</span>${pending}</div>`;
    }).join('');
    container.innerHTML = html;
}

function localTimeInputFromPunchTime(punchTime) {
    if (!punchTime) return '';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: companyTimezone || 'UTC',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date(punchTime));
        const hour = parts.find((p) => p.type === 'hour')?.value || '00';
        const minute = parts.find((p) => p.type === 'minute')?.value || '00';
        return `${hour}:${minute}`;
    } catch (_) {
        const d = new Date(punchTime);
        if (Number.isNaN(d.getTime())) return '';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
}

function loadPendingCorrections() {
    const listEl = document.getElementById('pending-corrections-list');
    const badge = document.getElementById('pending-corrections-badge');
    if (!listEl && !badge) return;

    fetch(`${API_BASE}/pending-corrections`, { credentials: 'include' })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to load pending corrections');
            return data;
        })
        .then((data) => {
            const items = Array.isArray(data.items) ? data.items : [];
            const count = Number(data.count) || items.length;
            if (badge) {
                badge.textContent = String(count);
                badge.classList.toggle('hidden', count === 0);
            }
            if (!listEl) return;
            if (items.length === 0) {
                listEl.innerHTML = '<p style="color: #666;">No missing clock-outs or pending approvals.</p>';
                return;
            }
            listEl.innerHTML = items.map((item) => {
                if (item.kind === 'missing_clock_out') {
                    const dateStr = item.punch_local_date || '';
                    const safeId = escapeHtml(item.id);
                    return `
                        <div class="pending-correction-card" data-missing-id="${safeId}">
                            <h4>${escapeHtml(item.employee_name || 'Employee')}
                                <span class="pending-flag" style="margin-left: 8px;">Missing Clock-Out</span>
                            </h4>
                            <div class="pending-correction-meta">
                                Work date: <strong>${formatShortDate(dateStr)}</strong><br>
                                Clocked in: <strong>${formatTimeOnly(item.clock_in_time)}</strong> — no Time Out recorded.
                            </div>
                            <div class="pending-correction-actions">
                                <div class="form-group">
                                    <label for="missing-time-${safeId}">Set clock-out time</label>
                                    <input type="time" id="missing-time-${safeId}" required>
                                </div>
                                <button type="button" class="btn btn-success" style="width: auto;"
                                    data-resolve-missing="${safeId}"
                                    data-employee-id="${escapeHtml(item.employee_id)}"
                                    data-date="${escapeHtml(dateStr)}">Save Clock-Out</button>
                            </div>
                        </div>
                    `;
                }

                const dateStr = item.punch_local_date || getLocalDateStringInTz(item.punch_time, companyTimezone);
                const timeVal = localTimeInputFromPunchTime(item.punch_time);
                return `
                    <div class="pending-correction-card" data-punch-id="${escapeHtml(item.id)}">
                        <h4>${escapeHtml(item.employee_name || 'Employee')}
                            <span class="pending-flag" style="margin-left: 8px;">Pending Approval</span>
                        </h4>
                        <div class="pending-correction-meta">
                            Claimed clock-out: <strong>${formatShortDate(dateStr)}</strong> at <strong>${formatTimeOnly(item.punch_time)}</strong>
                            ${item.notes ? `<div style="margin-top: 6px;">${escapeHtml(item.notes)}</div>` : ''}
                        </div>
                        <div class="pending-correction-actions">
                            <div class="form-group">
                                <label for="pending-time-${escapeHtml(item.id)}">Correct time (optional)</label>
                                <input type="time" id="pending-time-${escapeHtml(item.id)}" value="${timeVal}">
                            </div>
                            <button type="button" class="btn btn-success" style="width: auto;" data-approve-pending="${escapeHtml(item.id)}" data-date="${escapeHtml(dateStr || '')}">Approve</button>
                            <button type="button" class="btn btn-danger" style="width: auto;" data-reject-pending="${escapeHtml(item.id)}">Reject</button>
                        </div>
                    </div>
                `;
            }).join('');
        })
        .catch((err) => {
            console.error('loadPendingCorrections:', err);
            if (listEl) listEl.innerHTML = `<p style="color: #c00;">${escapeHtml(err.message || 'Could not load pending corrections.')}</p>`;
        });
}

function resolveMissingClockOutFromManager(employeeId, dateStr, itemId) {
    const timeEl = document.getElementById(`missing-time-${itemId}`);
    const timeVal = timeEl?.value || '';
    if (!employeeId || !dateStr || !timeVal) {
        showMessage('Enter a clock-out time first.', 'error');
        return;
    }

    fetch(`${API_BASE}/pending-corrections/resolve-missing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            employee_id: employeeId,
            local_date: dateStr,
            clock_out_time: timeVal,
        }),
    })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not save clock-out');
            return data;
        })
        .then(() => {
            showMessage('Clock-out saved.', 'success');
            loadPendingCorrections();
        })
        .catch((err) => showMessage(err.message || 'Could not save clock-out', 'error'));
}

function reviewPendingCorrection(punchId, action, dateStr) {
    if (!punchId) return;
    const body = { action };
    if (action === 'approve') {
        const timeEl = document.getElementById(`pending-time-${punchId}`);
        const timeVal = timeEl?.value || '';
        if (timeVal && dateStr) {
            body.punch_time = `${dateStr}T${timeVal}`;
        }
    }

    fetch(`${API_BASE}/punches/${encodeURIComponent(punchId)}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
    })
        .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Review failed');
            return data;
        })
        .then(() => {
            showMessage(action === 'approve' ? 'Correction approved.' : 'Correction rejected and removed.', 'success');
            loadPendingCorrections();
        })
        .catch((err) => showMessage(err.message || 'Could not review correction', 'error'));
}

function handleManagerPunch(punchType) {
    const noteEl = document.getElementById('my-clock-note');
    const notes = noteEl ? noteEl.value.trim() : '';
    fetch(`${API_BASE}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ punch_type: punchType, notes: notes || null }),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text.trim()) data = JSON.parse(text);
            } catch (_) {}
            return { ok: res.ok, status: res.status, data };
        })
        .then(({ ok, status, data }) => {
            if (ok && data.success) {
                showMessage('Punch recorded.', 'success');
                if (noteEl) noteEl.value = '';
                loadMyClockPunches();
            } else if (data.code === 'MISSING_CLOCK_OUT') {
                openMissingClockOutModal(data, { noteText: notes || null, source: 'manager' });
            } else {
                if (status === 409 || data.code === 'DUPLICATE_PUNCH_TYPE_FOR_DAY') {
                    showMessage(data.error || 'Duplicate punch for that day.', 'error');
                } else {
                    showMessage(data.error || 'Failed to record punch', 'error');
                }
            }
        })
        .catch(() => showMessage('Error recording punch', 'error'));
}

function loadEmployees(status = 'active') {
    const url = status ? `${API_BASE}/employees?status=${status}` : `${API_BASE}/employees`;
    return fetch(url, {
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            employees = data;
            displayEmployees(data);
            return data;
        })
        .catch(err => {
            console.error('Error loading employees:', err);
        });
}

function displayEmployees(employeesList) {
    const select = document.getElementById('employee-management-select');
    const detailsContainer = document.getElementById('employee-management-details');
    if (!select || !detailsContainer) return;

    const previousValue = select.value;
    const optionsHtml = '<option value="">-- Select an employee --</option>' +
        employeesList.map(emp => `<option value="${String(emp.id)}">${emp.name} (${emp.employee_number})</option>`).join('');
    select.innerHTML = employeesList.length === 0 ? '<option value="">-- Select an employee --</option>' : optionsHtml;

    if (employeesList.length === 0) {
        detailsContainer.innerHTML = '<p>No employees found. Add your first employee!</p>';
        return;
    }

    if (previousValue && employeesList.some(emp => String(emp.id) === previousValue)) {
        select.value = previousValue;
    }
    updateEmployeeManagementDetails();
}

function updateEmployeeManagementDetails() {
    const select = document.getElementById('employee-management-select');
    const detailsContainer = document.getElementById('employee-management-details');
    if (!select || !detailsContainer) return;

    const selectedId = select.value;
    if (!selectedId) {
        detailsContainer.innerHTML = '<p style="color: #666;">Select an employee from the dropdown above to view details, edit, or terminate.</p>';
        return;
    }

    const emp = employees.find(e => String(e.id) === selectedId);
    if (!emp) {
        detailsContainer.innerHTML = '<p style="color: #666;">Select an employee from the dropdown above.</p>';
        return;
    }

    const isActiveEmp = emp.active === 1 || emp.active === '1';
    const statusBadge = isActiveEmp
        ? '<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Active</span>'
        : '<span style="background: #dc3545; color: white; padding: 3px 8px; border-radius: 12px; font-size: 12px; margin-left: 10px;">Inactive</span>';

    const termLine =
        !isActiveEmp && emp.termination_date
            ? `<p style="color:#666;font-size:14px;margin:8px 0 0 0;">Termination date: <strong>${escapeHtml(String(emp.termination_date))}</strong></p>`
            : '';

    const hasManager = emp.has_manager === true || emp.has_manager === '1';
    const empId = String(emp.id);
    const empIdEsc = empId.replace(/'/g, "\\'");
    const roleSegId = 'role-seg-' + empId.replace(/[^a-zA-Z0-9-]/g, '_');
    const roleSegment = `
        <span class="role-segmented" id="${roleSegId}" data-employee-id="${escapeHtml(empId)}">
            <button type="button" class="role-seg-opt ${!hasManager ? 'active' : ''}" data-role="employee" aria-pressed="${!hasManager}">Employee</button>
            <button type="button" class="role-seg-opt ${hasManager ? 'active' : ''}" data-role="manager" aria-pressed="${hasManager}">Manager</button>
        </span>`;

    detailsContainer.innerHTML = `
        <div class="employee-card">
            <div class="employee-info">
                <h4>${escapeHtml(emp.name)}${statusBadge}${roleSegment}</h4>
                <p>Employee #: ${escapeHtml(emp.employee_number)}${emp.phone ? ` | Phone: ${escapeHtml(emp.phone)}` : ''}</p>
                ${termLine}
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button type="button" class="btn btn-primary btn-save-role">Save</button>
                <button class="btn btn-primary" onclick="editEmployee('${empIdEsc}')">Edit</button>
                ${isActiveEmp ? `<button type="button" class="btn btn-danger" onclick="openTerminateEmployeeModal('${empIdEsc}')">Terminate</button>` : ''}
            </div>
        </div>
    `;
}

function escapeHtml(s) {
    if (s == null) return '';
    const str = String(s);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
        const hasOrig = punch.original_punch_time != null && String(punch.original_punch_time).length > 0;
        const wasAdjusted = hasOrig && new Date(punch.original_punch_time).getTime() !== new Date(punch.punch_time).getTime();
        const origLine = wasAdjusted
            ? `<div style="margin-top: 6px; font-size: 13px; color: #856404;"><strong>Originally:</strong> ${formatDateTime(new Date(punch.original_punch_time))}</div>`
            : '';
        return `
            <div class="employee-card" style="margin-bottom: 15px;">
                <div style="flex: 1;">
                    <h4>${punch.employee_name || 'Employee'} (${punch.employee_number || ''})</h4>
                    <p>
                        <span class="record-type ${typeClass}">${formatPunchType(punch.punch_type)}</span>
                        <span style="margin-left: 15px;">${formatDateTime(date)}</span>
                        ${origLine}
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
    Promise.all([
        fetch(`${API_BASE}/punches/${id}`, { credentials: 'include' }).then((res) => res.json()),
        fetch(`${API_BASE}/company-settings`, { credentials: 'include' })
            .then((res) => res.json())
            .catch(() => ({})),
    ])
        .then(([data, settings]) => {
            if (data.error) {
                showMessage(data.error || 'Punch not found', 'error');
                return;
            }
            if (settings?.timezone && String(settings.timezone).trim()) {
                companyTimezone = String(settings.timezone).trim();
            }
            const { dateStr, timeStr } = utcToLocalDateAndTimeInTz(data.punch_time, companyTimezone);
            if (!dateStr || !timeStr) {
                showMessage('Could not load punch time for editing.', 'error');
                return;
            }
            document.getElementById('edit-punch-id').value = data.id || id;
            document.getElementById('edit-punch-type').value = data.punch_type || 'clock_in';
            document.getElementById('edit-punch-date').value = dateStr;
            document.getElementById('edit-punch-time').value = timeStr.slice(0, 5);
            document.getElementById('edit-punch-notes').value = data.notes || '';
            const origWrap = document.getElementById('edit-punch-original-wrap');
            const origText = document.getElementById('edit-punch-original-text');
            if (origWrap && origText) {
                const hasOrig = data.original_punch_time != null && String(data.original_punch_time).length > 0;
                const curT = data.punch_time ? new Date(data.punch_time).getTime() : 0;
                const origT = hasOrig ? new Date(data.original_punch_time).getTime() : curT;
                if (hasOrig && origT !== curT) {
                    origText.textContent = formatDateTime(new Date(data.original_punch_time));
                    origWrap.classList.remove('hidden');
                } else {
                    origWrap.classList.add('hidden');
                }
            }
            document.getElementById('edit-punch-modal').classList.remove('hidden');
            // #region agent log
            requestAnimationFrame(() => {
                const modalEl = document.getElementById('edit-punch-modal');
                const contentEl = modalEl && modalEl.querySelector('.modal-content');
                const closeEl = modalEl && modalEl.querySelector('.close-edit-punch');
                const cs = contentEl && getComputedStyle(contentEl);
                const closeCs = closeEl && getComputedStyle(closeEl);
                const cr = closeEl && closeEl.getBoundingClientRect();
                const mr = contentEl && contentEl.getBoundingClientRect();
                const closeCenterX = cr ? cr.left + cr.width / 2 : null;
                const modalCenterX = mr ? mr.left + mr.width / 2 : null;
                const deltaCenter = closeCenterX != null && modalCenterX != null ? Math.abs(closeCenterX - modalCenterX) : null;
                const gapModalRightMinusCloseRight = cr && mr ? mr.right - cr.right : null;
                fetch('http://127.0.0.1:7485/ingest/ffcfd3e8-df26-4f65-aca1-565e0ff3ca4e', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c34797' }, body: JSON.stringify({ sessionId: 'c34797', runId: 'post-css', hypothesisId: 'H1-H5', location: 'app.js:editPunch', message: 'edit-punch modal layout probe', data: { modalContentTextAlign: cs && cs.textAlign, closePosition: closeCs && closeCs.position, closeRight: cr && cr.right, modalRight: mr && mr.right, deltaCloseCenterToModalCenterPx: deltaCenter, gapModalRightMinusCloseRightPx: gapModalRightMinusCloseRight }, timestamp: Date.now() }) }).catch(() => {});
            });
            // #endregion
        })
        .catch(() => showMessage('Error loading punch', 'error'));
}

function handleEditPunchSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-punch-id').value;
    if (!id) {
        showMessage('Punch ID missing. Close and open Edit again.', 'error');
        return;
    }
    const punchType = document.getElementById('edit-punch-type').value;
    const date = document.getElementById('edit-punch-date').value;
    const time = document.getElementById('edit-punch-time').value;
    const notes = document.getElementById('edit-punch-notes').value.trim();
    const utcDate = localDateTimeInTzToUtc(date, time, companyTimezone);
    if (!utcDate || Number.isNaN(utcDate.getTime())) {
        showMessage('Invalid date or time. Check the date and time fields.', 'error');
        return;
    }
    const punchTime = utcDate.toISOString();
    fetch(`${API_BASE}/punches/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ punch_type: punchType, punch_time: punchTime, notes: notes || null })
    })
        .then(async (res) => {
            let data = {};
            try {
                data = await res.json();
            } catch (_) {}
            return { ok: res.ok, status: res.status, data };
        })
        .then(({ ok, status, data }) => {
            if (ok && data.success) {
                document.getElementById('edit-punch-modal').classList.add('hidden');
                showMessage('Punch updated', 'success');
                loadPunchesForEdit();
            } else {
                showMessage(data.error || `Failed to update punch (${status})`, 'error');
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

let editEmpMustChangePassword = false;
/** Password loaded from API for the employee currently in the edit modal (empty if not stored for viewing). */
let editEmpStoredPassword = '';
let editEmpHasStoredPassword = false;

// Default temp password for new/reset employees; they must change it on first login.
const DEFAULT_TEMP_PASSWORD = 'password123';

function generateClientTempPassword() {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    const b64 = btoa(String.fromCharCode(...bytes));
    return b64.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

function resetEditEmpPasswordToggleUi() {
    const btn = document.getElementById('edit-emp-password-toggle');
    if (!btn) return;
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('title', 'Show password');
    const showIcon = btn.querySelector('.pwd-icon-show');
    const hideIcon = btn.querySelector('.pwd-icon-hide');
    if (showIcon) showIcon.style.display = '';
    if (hideIcon) hideIcon.style.display = 'none';
}

function toggleEditEmpPasswordVisibility() {
    const input = document.getElementById('edit-emp-password');
    if (!input) return;
    const value = input.value.trim();
    const canRevealStored = editEmpHasStoredPassword && editEmpStoredPassword;
    if (!value && !canRevealStored) {
        setEditEmployeeSendLoginMessage(
            'Password is not stored for viewing. Use Create new password or Reset Password & Text Link.',
            true
        );
        return;
    }
    if (input.type === 'password' && !value && canRevealStored) {
        input.value = editEmpStoredPassword;
    }
    setEditEmployeeSendLoginMessage('', false);
    togglePasswordVisibility('edit-emp-password', 'edit-emp-password-toggle');
}

function showEditEmpPasswordPlaintext() {
    const input = document.getElementById('edit-emp-password');
    const btn = document.getElementById('edit-emp-password-toggle');
    if (!input || input.type === 'text') return;
    input.type = 'text';
    if (btn) {
        btn.setAttribute('aria-label', 'Hide password');
        btn.setAttribute('title', 'Hide password');
        const showIcon = btn.querySelector('.pwd-icon-show');
        const hideIcon = btn.querySelector('.pwd-icon-hide');
        if (showIcon) showIcon.style.display = 'none';
        if (hideIcon) hideIcon.style.display = '';
    }
}

function handleEditEmpGeneratePassword() {
    const input = document.getElementById('edit-emp-password');
    if (!input) return;
    const generated = DEFAULT_TEMP_PASSWORD;
    input.value = generated;
    input.removeAttribute('data-is-placeholder');
    editEmpStoredPassword = generated;
    editEmpHasStoredPassword = true;
    editEmpMustChangePassword = true;
    setEditEmployeeSendLoginMessage('', false);
    showEditEmpPasswordPlaintext();
}

/** Edit modal: original values from API when modal opened (for username auto-sync). */
let editEmpOriginalName = '';
let editEmpOriginalUsername = '';
let editEmpUsernameManuallyEdited = false;
let suppressEditUsernameInputEvent = false;

/** True when username should be replaced with first+last-initial (blank or still employee #). */
function shouldAutoDefaultLoginUsername(username, employeeNumber) {
    const u = String(username ?? '').trim();
    if (!u) return true;
    const e = String(employeeNumber ?? '').trim();
    if (!e) return false;
    if (u === e) return true;
    if (/^\d+$/.test(u) && /^\d+$/.test(e)) {
        const nu = parseInt(u, 10);
        const ne = parseInt(e, 10);
        if (!Number.isNaN(nu) && !Number.isNaN(ne) && nu === ne) return true;
    }
    return false;
}

/** Same rule as server: first name + last initial, e.g. Josh Doe -> JoshD */
function suggestedLoginUsernameFromFullName(fullName) {
    const trimmed = String(fullName || '').trim();
    if (!trimmed) return '';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    const firstSan = parts[0].replace(/[^a-zA-Z0-9]/g, '');
    if (!firstSan) return '';
    const first = firstSan.charAt(0).toUpperCase() + firstSan.slice(1).toLowerCase();
    if (parts.length === 1) return first;
    const last = parts[parts.length - 1];
    const letter = last.match(/[a-zA-Z]/);
    if (!letter) return first;
    return first + letter[0].toUpperCase();
}

function resolveEditFormUsername(employee) {
    const stored = employee.username != null ? String(employee.username).trim() : '';
    const empNum = String(employee.employee_number ?? '').trim();
    const name = String(employee.name ?? '').trim();
    if (!shouldAutoDefaultLoginUsername(stored, empNum)) return stored;
    const suggested = suggestedLoginUsernameFromFullName(name);
    return suggested || stored;
}

function maybeSyncEditUsernameFromName() {
    if (editEmpUsernameManuallyEdited) return;
    const userEl = document.getElementById('edit-emp-username');
    const nameEl = document.getElementById('edit-emp-name');
    const numberEl = document.getElementById('edit-emp-number');
    if (!userEl || !nameEl) return;
    const current = userEl.value.trim();
    const empNum = numberEl ? numberEl.value.trim() : '';
    const origU = String(editEmpOriginalUsername ?? '').trim();
    const origName = String(editEmpOriginalName ?? '').trim();
    const maySync =
        !current ||
        current === empNum ||
        current === origU ||
        current === suggestedLoginUsernameFromFullName(origName);
    if (!maySync) return;
    const next = suggestedLoginUsernameFromFullName(nameEl.value.trim());
    if (!next) return;
    suppressEditUsernameInputEvent = true;
    userEl.value = next;
    suppressEditUsernameInputEvent = false;
}

function populateEditForm(employee) {
    editEmpOriginalName = String(employee.name ?? '').trim();
    editEmpOriginalUsername = employee.username != null ? String(employee.username).trim() : '';
    editEmpUsernameManuallyEdited = false;

    document.getElementById('edit-emp-id').value = employee.id;
    document.getElementById('edit-emp-name').value = employee.name || '';
    document.getElementById('edit-emp-number').value = employee.employee_number || '';
    const userEl = document.getElementById('edit-emp-username');
    if (userEl) userEl.value = resolveEditFormUsername(employee);
    document.getElementById('edit-emp-phone').value = formatPhoneNumber(employee.phone || '');
    setEditEmployeeSendLoginMessage('', false);
    updateEditEmployeeSendLoginTextButton(employee.phone || '');
    editEmpMustChangePassword = false;
    const pwdInput = document.getElementById('edit-emp-password');
    const hasRealPassword = employee.password != null && String(employee.password).trim() !== '';
    editEmpStoredPassword = hasRealPassword ? String(employee.password).trim() : '';
    editEmpHasStoredPassword = hasRealPassword;
    pwdInput.value = hasRealPassword ? editEmpStoredPassword : '';
    pwdInput.type = 'password';
    pwdInput.removeAttribute('data-is-placeholder');
    pwdInput.placeholder = hasRealPassword
        ? 'Leave blank to keep current password'
        : 'Password not available to view';
    resetEditEmpPasswordToggleUi();
    document.getElementById('edit-emp-status').value = (employee.active === 1 || employee.active === '1') ? '1' : '0';
    const hasManager = employee.has_manager === true || employee.has_manager === '1';
    const managerSectionEl = document.getElementById('edit-employee-manager-section');
    if (managerSectionEl) {
        const empId = String(employee.id || employee._id || '');
        const empIdEsc = empId.replace(/'/g, "\\'");
        const statusLabel = hasManager
            ? '<span class="manager-rights-status is-manager">Current: Manager</span>'
            : '<span class="manager-rights-status is-employee">Current: Employee only</span>';
        const statusHint = hasManager
            ? 'They see the manager dashboard when they log in.'
            : 'They see the time clock only (no manager dashboard).';
        managerSectionEl.innerHTML = `
            <div class="manager-rights-section" style="padding: 12px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e0e0e0;">
                <strong>Manager rights</strong>
                <p class="manager-rights-status-row">${statusLabel}</p>
                <p class="manager-rights-status-hint">${statusHint}</p>
                <div class="edit-manager-rights-actions" style="margin-top: 10px;">
                    <button type="button" class="btn btn-primary btn-small" onclick="openGrantManagerModalFromEditModal('${empIdEsc}')" ${hasManager ? 'disabled' : ''}>Grant manager rights</button>
                    <button type="button" class="btn btn-danger btn-small" onclick="revokeManagerRightsFromEditModal('${empIdEsc}')" ${!hasManager ? 'disabled' : ''}>Take away manager rights</button>
                </div>
                <small style="display: block; margin-top: 8px; color: #666;">Same login (name + password); grant = manager dashboard, take away = time clock only.</small>
            </div>`;
    }
    document.getElementById('edit-employee-modal').classList.remove('hidden');
}

function setupEditPasswordPlaceholder() {
    const input = document.getElementById('edit-emp-password');
    if (!input) return;
    input.addEventListener('focus', function () {
        if (editEmpHasStoredPassword && this.value === editEmpStoredPassword) {
            this.value = '';
            this.removeAttribute('data-is-placeholder');
        }
    });
    input.addEventListener('blur', function () {
        const trimmed = this.value.trim();
        if (trimmed === '') {
            if (editEmpHasStoredPassword && editEmpStoredPassword) {
                this.value = editEmpStoredPassword;
                this.type = 'password';
                resetEditEmpPasswordToggleUi();
            }
            editEmpMustChangePassword = false;
        } else if (trimmed !== editEmpStoredPassword) {
            editEmpStoredPassword = trimmed;
            editEmpHasStoredPassword = true;
        }
    });
}

function handleEditEmployee(e) {
    e.preventDefault();
    const id = document.getElementById('edit-emp-id').value;
    let newPassword = document.getElementById('edit-emp-password').value.trim();
    const openedWithStoredPassword = editEmpHasStoredPassword && editEmpStoredPassword;
    if (openedWithStoredPassword && newPassword === editEmpStoredPassword && !editEmpMustChangePassword) {
        newPassword = '';
    }
    const employee = {
        name: document.getElementById('edit-emp-name').value,
        employee_number: document.getElementById('edit-emp-number').value,
        username: (document.getElementById('edit-emp-username')?.value ?? '').trim(),
        phone: document.getElementById('edit-emp-phone').value,
        active: parseInt(document.getElementById('edit-emp-status').value)
    };
    if (newPassword) {
        employee.password = newPassword;
        if (editEmpMustChangePassword) employee.mustChangePassword = true;
    }

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
        showMessage(
            editEmpMustChangePassword && newPassword
                ? 'Employee updated with new temporary password (must change on next login)'
                : newPassword
                    ? 'Employee and password updated successfully'
                    : 'Employee updated successfully',
            'success'
        );
        document.getElementById('edit-employee-modal').classList.add('hidden');
        document.getElementById('edit-employee-form').reset();
        editEmpUsernameManuallyEdited = false;
        editEmpMustChangePassword = false;
        editEmpStoredPassword = '';
        editEmpHasStoredPassword = false;
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

function openTerminateEmployeeModal(id) {
    if (!id) return;
    const emp = employees.find((e) => String(e.id) === String(id));
    if (!emp) {
        showMessage('Employee not found in the current list.', 'error');
        return;
    }
    const isActiveEmp = emp.active === 1 || emp.active === '1';
    if (!isActiveEmp) {
        showMessage('This employee is already inactive.', 'error');
        return;
    }
    const idInput = document.getElementById('terminate-employee-id');
    const nameEl = document.getElementById('terminate-employee-name');
    const dateEl = document.getElementById('terminate-employee-date');
    if (idInput) idInput.value = String(id);
    if (nameEl) nameEl.textContent = emp.name ? String(emp.name) : '';
    if (dateEl) {
        const t = new Date();
        dateEl.value =
            t.getFullYear() +
            '-' +
            String(t.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(t.getDate()).padStart(2, '0');
    }
    document.getElementById('terminate-employee-modal')?.classList.remove('hidden');
}

function handleTerminateEmployeeSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('terminate-employee-id')?.value;
    const termination_date = document.getElementById('terminate-employee-date')?.value;
    if (!id || !termination_date) {
        showMessage('Termination date is required.', 'error');
        return;
    }
    fetch(`${API_BASE}/employees/${encodeURIComponent(id)}/terminate`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termination_date }),
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text && text.trim()) data = JSON.parse(text);
            } catch (_) {
                data = { error: res.statusText || 'Server error' };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                showMessage('Employee terminated. Their record is kept for history.', 'success');
                document.getElementById('terminate-employee-modal')?.classList.add('hidden');
                document.getElementById('terminate-employee-form')?.reset();
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
                loadEmployeesForPunch();
                loadEmployeesForReport();
            } else {
                showMessage(data.error || 'Could not terminate employee', 'error');
            }
        })
        .catch(() => showMessage('Could not terminate employee', 'error'));
}

function setEmployeeRoleFromCard(employeeId, isManager, segContainerEl) {
    if (!employeeId || !segContainerEl) {
        showMessage('Cannot update role: missing employee.', 'error');
        return;
    }
    const card = segContainerEl.closest('.employee-card');
    const opts = segContainerEl.querySelectorAll('.role-seg-opt');
    const saveBtn = card?.querySelector('.btn-save-role');
    opts.forEach((b) => { b.disabled = true; });
    if (saveBtn) saveBtn.disabled = true;
    const endpoint = isManager ? 'grant-manager' : 'revoke-manager';
    const url = `${API_BASE}/employees/${encodeURIComponent(employeeId)}/${endpoint}`;
    fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text && text.trim()) data = JSON.parse(text);
            } catch (_) {
                data = { error: res.statusText || ('Server error ' + res.status) };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                showMessage(data.message || (isManager ? 'Manager rights granted.' : 'Manager rights revoked.'), 'success');
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter).then(() => {
                    const select = document.getElementById('employee-management-select');
                    if (select) select.value = employeeId;
                    updateEmployeeManagementDetails();
                });
            } else {
                showMessage(data.error || 'Failed to update role', 'error');
                opts.forEach((b) => { b.disabled = false; });
                if (saveBtn) saveBtn.disabled = false;
            }
        })
        .catch((err) => {
            showMessage(err.message || 'Error updating role', 'error');
            opts.forEach((b) => { b.disabled = false; });
            if (saveBtn) saveBtn.disabled = false;
        });
}

function openGrantManagerModal(employeeId) {
    const emp = employees.find(e => String(e.id) === String(employeeId));
    if (!emp) return;
    document.getElementById('grant-manager-employee-id').value = employeeId;
    document.getElementById('grant-manager-employee-name').textContent = emp.name + ' (# ' + (emp.employee_number || '') + ')';
    document.getElementById('grant-manager-message').textContent = '';
    document.getElementById('grant-manager-modal').classList.remove('hidden');
}

function openGrantManagerModalFromEditModal(employeeId) {
    const nameEl = document.getElementById('edit-emp-name');
    const numberEl = document.getElementById('edit-emp-number');
    const name = (nameEl && nameEl.value) ? nameEl.value.trim() : 'Employee';
    const num = (numberEl && numberEl.value) ? numberEl.value.trim() : '';
    document.getElementById('grant-manager-employee-id').value = employeeId;
    document.getElementById('grant-manager-employee-name').textContent = name + (num ? ' (# ' + num + ')' : '');
    document.getElementById('grant-manager-message').textContent = '';
    document.getElementById('grant-manager-modal').classList.remove('hidden');
}

function revokeManagerRightsFromEditModal(employeeId) {
    const nameEl = document.getElementById('edit-emp-name');
    const name = (nameEl && nameEl.value) ? nameEl.value.trim() : 'this employee';
    if (!confirm('Take away manager rights for ' + name + '? They will keep the same login but see the employee time clock instead of the manager dashboard.')) return;
    fetch(`${API_BASE}/employees/${employeeId}/revoke-manager`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text && text.trim()) data = JSON.parse(text);
            } catch (_) {
                data = { error: res.statusText || ('Server error ' + res.status) };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                showMessage(data.message || 'Manager rights revoked.', 'success');
                document.getElementById('edit-employee-modal').classList.add('hidden');
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
                updateEmployeeManagementDetails();
            } else {
                showMessage(data.error || 'Failed to revoke', 'error');
            }
        })
        .catch((err) => showMessage(err.message || 'Error revoking manager rights', 'error'));
}

function revokeManagerRights(employeeId) {
    const emp = employees.find(e => String(e.id) === String(employeeId));
    if (!emp || !confirm('Revoke manager rights for ' + (emp.name || 'this employee') + '? They will keep the same login but see the employee time clock instead of the manager dashboard.')) return;
    fetch(`${API_BASE}/employees/${employeeId}/revoke-manager`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text && text.trim()) data = JSON.parse(text);
            } catch (_) {
                data = { error: res.statusText || ('Server error ' + res.status) };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                showMessage(data.message || 'Manager rights revoked.', 'success');
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
            } else {
                showMessage(data.error || 'Failed to revoke', 'error');
            }
        })
        .catch((err) => showMessage(err.message || 'Error revoking manager rights', 'error'));
}

function handleConfirmGrantManager() {
    const id = document.getElementById('grant-manager-employee-id')?.value?.trim();
    const msgEl = document.getElementById('grant-manager-message');
    if (!id || id === 'undefined' || id.length < 10) {
        msgEl.textContent = 'No employee selected. Please select an employee from the list and click Grant manager rights again.';
        msgEl.style.color = 'red';
        return;
    }
    msgEl.textContent = 'Saving...';
    msgEl.style.color = '#666';
    fetch(`${API_BASE}/employees/${id}/grant-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include'
    })
        .then(async (res) => {
            const text = await res.text();
            let data = {};
            try {
                if (text && text.trim()) data = JSON.parse(text);
            } catch (_) {
                data = { error: res.statusText || ('Server error ' + res.status) };
            }
            return { ok: res.ok, data };
        })
        .then(({ ok, data }) => {
            if (ok && data.success) {
                msgEl.textContent = data.message || 'Manager rights granted.';
                msgEl.style.color = 'green';
                document.getElementById('grant-manager-modal').classList.add('hidden');
                showMessage(data.message || 'Manager rights granted.', 'success');
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
            } else {
                msgEl.textContent = data.error || 'Failed.';
                msgEl.style.color = 'red';
            }
        })
        .catch((err) => {
            msgEl.textContent = err.message || 'Request failed. Check network and server.';
            msgEl.style.color = 'red';
        });
}

function prefetchAddEmployeeNumber() {
    const empNumberInput = document.getElementById('emp-number');
    if (!empNumberInput) return;
    empNumberInput.value = '';
    empNumberInput.placeholder = 'Loading…';
    fetch(`${API_BASE}/employees/next-number`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            empNumberInput.placeholder = 'Leave blank to auto-generate';
            if (data && data.nextNumber) empNumberInput.value = data.nextNumber;
        })
        .catch(() => {
            empNumberInput.placeholder = 'Leave blank to auto-generate';
        });
}

function openAddEmployeeModal() {
    const modal = document.getElementById('add-employee-modal');
    if (!modal) return;
    showAddEmployeeForm();
    modal.classList.remove('hidden');
    prefetchAddEmployeeNumber();
}

function closeAddEmployeeModal() {
    const modal = document.getElementById('add-employee-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    showAddEmployeeForm();
}

function showAddEmployeeForm() {
    document.getElementById('add-employee-form-panel')?.classList.remove('hidden');
    document.getElementById('add-employee-success-panel')?.classList.add('hidden');
    document.getElementById('add-employee-form')?.reset();
    setDateInputValue('emp-hire-date', '');
    const msgEl = document.getElementById('add-employee-success-message');
    if (msgEl) {
        msgEl.textContent = '';
        msgEl.style.color = '';
    }
    const modal = document.getElementById('add-employee-modal');
    if (modal) {
        delete modal.dataset.employeeId;
        delete modal.dataset.phone;
        delete modal.dataset.username;
        delete modal.dataset.tempPassword;
    }
}

function setAddEmployeeSuccessMessage(text, isError) {
    const msgEl = document.getElementById('add-employee-success-message');
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.color = isError ? '#c0392b' : '#2e7d32';
}

function updateAddEmployeeSendLoginTextButton(phone) {
    const btn = document.getElementById('add-employee-send-login-text-btn');
    if (!btn) return;
    const hasPhone = !!(phone && String(phone).trim());
    btn.disabled = !hasPhone;
    if (hasPhone) {
        btn.removeAttribute('title');
    } else {
        btn.title = 'Add a phone number to send the login password & app link. Edit the employee later to add one.';
    }
}

function showAddEmployeeSuccess({ username, tempPassword, employeeId, phone }) {
    document.getElementById('add-employee-form-panel')?.classList.add('hidden');
    document.getElementById('add-employee-success-panel')?.classList.remove('hidden');
    const usernameEl = document.getElementById('add-employee-success-username');
    const passwordEl = document.getElementById('add-employee-success-password');
    if (usernameEl) usernameEl.textContent = username || '—';
    if (passwordEl) passwordEl.textContent = tempPassword || '—';
    setAddEmployeeSuccessMessage('', false);
    updateAddEmployeeSendLoginTextButton(phone);
    const modal = document.getElementById('add-employee-modal');
    if (modal) {
        if (employeeId) modal.dataset.employeeId = String(employeeId);
        modal.dataset.phone = phone ? String(phone).trim() : '';
        modal.dataset.username = username || '';
        modal.dataset.tempPassword = tempPassword || '';
    }
}

async function copyAddEmployeeCredentials() {
    const modal = document.getElementById('add-employee-modal');
    const username = modal?.dataset.username || document.getElementById('add-employee-success-username')?.textContent || '';
    const tempPassword = modal?.dataset.tempPassword || document.getElementById('add-employee-success-password')?.textContent || '';
    const text = `Username: ${username}\nTemporary Password: ${tempPassword}`;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setAddEmployeeSuccessMessage('Credentials copied to clipboard.', false);
    } catch (_) {
        setAddEmployeeSuccessMessage('Could not copy. Select and copy the credentials manually.', true);
    }
}

function setEditEmployeeSendLoginMessage(text, isError) {
    const msgEl = document.getElementById('edit-employee-send-login-message');
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.color = isError ? '#c0392b' : '#2e7d32';
}

function updateEditEmployeeSendLoginTextButton(phone) {
    const hasPhone = !!(phone && String(phone).replace(/\D/g, '').trim());
    const noPhoneTitle = 'Add a phone number and save the employee to send a text.';
    ['edit-employee-send-app-link-btn', 'edit-employee-send-login-text-btn'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !hasPhone;
        if (hasPhone) btn.removeAttribute('title');
        else btn.title = noPhoneTitle;
    });
}

function sendEditEmployeeText(mode) {
    const employeeId = document.getElementById('edit-emp-id')?.value;
    if (!employeeId) {
        setEditEmployeeSendLoginMessage('Employee ID missing. Close and try again.', true);
        return;
    }
    const isApp = mode === 'app';
    const isReset = mode === 'reset';
    const btn = document.getElementById(isApp ? 'edit-employee-send-app-link-btn' : 'edit-employee-send-login-text-btn');
    if (btn?.disabled) return;
    const phone = document.getElementById('edit-emp-phone')?.value || '';
    const otherBtn = document.getElementById(isApp ? 'edit-employee-send-login-text-btn' : 'edit-employee-send-app-link-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    setEditEmployeeSendLoginMessage(
        isApp ? 'Sending Home Screen link…' : 'Sending password reset link…',
        false
    );
    fetch(`${API_BASE}/employees/${employeeId}/send-login-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: isApp ? 'app' : (isReset ? 'reset' : 'login') }),
    })
        .then(async (res) => {
            const contentType = res.headers.get('content-type');
            const data = (contentType && contentType.includes('application/json')) ? await res.json() : {};
            if (res.ok && data.success) {
                setEditEmployeeSendLoginMessage(
                    data.message || (isApp ? 'Home Screen link sent.' : 'Password reset link sent.'),
                    false
                );
            } else {
                setEditEmployeeSendLoginMessage(
                    data.error || (isApp ? 'Failed to send Home Screen link.' : 'Failed to send reset link.'),
                    true
                );
            }
        })
        .catch(() => {
            setEditEmployeeSendLoginMessage('Could not send text. Check your connection and try again.', true);
        })
        .finally(() => {
            updateEditEmployeeSendLoginTextButton(phone);
        });
}

function sendAddEmployeeLoginText() {
    const modal = document.getElementById('add-employee-modal');
    const employeeId = modal?.dataset.employeeId;
    if (!employeeId) {
        setAddEmployeeSuccessMessage('Employee ID missing. Close and try again.', true);
        return;
    }
    const btn = document.getElementById('add-employee-send-login-text-btn');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    setAddEmployeeSuccessMessage('Sending app & login link…', false);
    fetch(`${API_BASE}/employees/${employeeId}/send-login-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'login' }),
    })
        .then(async (res) => {
            const contentType = res.headers.get('content-type');
            const data = (contentType && contentType.includes('application/json')) ? await res.json() : {};
            if (res.ok && data.success) {
                setAddEmployeeSuccessMessage(data.message || 'Login password & app link sent.', false);
            } else {
                setAddEmployeeSuccessMessage(data.error || 'Failed to send login text.', true);
            }
        })
        .catch(() => {
            setAddEmployeeSuccessMessage('Could not send login text. Check your connection and try again.', true);
        })
        .finally(() => {
            updateAddEmployeeSendLoginTextButton(modal?.dataset.phone || '');
        });
}

function handleAddEmployee(e) {
    e.preventDefault();
    const nameEl = document.getElementById('emp-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
        showMessage('Please enter the employee name.', 'error');
        return;
    }
    const hireDateInput = document.getElementById('emp-hire-date');
    const empNumberInput = document.getElementById('emp-number');
    const phoneRaw = document.getElementById('emp-phone')?.value ?? '';
    let employeeNumber = empNumberInput ? empNumberInput.value.trim() : '';

    function doSubmit(num) {
        const employee = {
            name,
            employee_number: num || '',
            phone: phoneRaw
        };
        if (hireDateInput && hireDateInput.value.trim()) {
            employee.hire_date = hireDateInput.value;
        }
        if (!employee.employee_number) delete employee.employee_number;

        const submitBtn = document.getElementById('add-employee-submit-btn');
        if (submitBtn) submitBtn.disabled = true;

        fetch(`${API_BASE}/employees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(employee),
            credentials: 'include'
        })
        .then(async (res) => {
            const contentType = res.headers.get('content-type');
            const data = (contentType && contentType.includes('application/json')) ? await res.json() : { error: 'Server error' };
            if (data.success) {
                showMessage('Employee added successfully!', 'success');
                showAddEmployeeSuccess({
                    username: data.username,
                    tempPassword: data.temp_password,
                    employeeId: data.id,
                    phone: phoneRaw,
                });
                const currentFilter = document.getElementById('employee-status-filter')?.value || 'active';
                loadEmployees(currentFilter);
                loadEmployeesForPunch();
                loadEmployeesForReport();
            } else {
                showMessage(data.error || 'Failed to add employee', 'error');
            }
        })
        .catch((err) => {
            console.error('Add employee error:', err);
            showMessage('Error adding employee. Check the console or try again.', 'error');
        })
        .finally(() => {
            if (submitBtn) submitBtn.disabled = false;
        });
    }

    if (employeeNumber) {
        doSubmit(employeeNumber);
    } else {
        fetch(`${API_BASE}/employees/next-number`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                const next = (data && data.nextNumber) ? data.nextNumber : '';
                if (next && empNumberInput) empNumberInput.value = next;
                doSubmit(next);
            })
            .catch(() => {
                doSubmit('');
            });
    }
}

function handleManualPunch(e) {
    e.preventDefault();
    const employeeId = document.getElementById('punch-employee')?.value?.trim();
    if (!employeeId) {
        showMessage('Please select an employee.', 'error');
        return;
    }
    const punchDate = document.getElementById('manual-punch-date')?.value?.trim() || '';
    const punchTimeOnly = document.getElementById('manual-punch-time')?.value?.trim() || '';
    const utcDate = (punchDate && punchTimeOnly)
        ? localDateTimeInTzToUtc(punchDate, punchTimeOnly, companyTimezone)
        : null;
    if (punchDate && punchTimeOnly && (!utcDate || Number.isNaN(utcDate.getTime()))) {
        showMessage('Invalid date or time.', 'error');
        return;
    }
    const manualPunchTime = utcDate ? utcDate.toISOString() : null;
    const punch = {
        employee_id: employeeId,
        punch_type: document.getElementById('punch-type').value,
        notes: document.getElementById('punch-notes').value.trim() || null,
        punch_time: manualPunchTime,
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
                const { dateStr, timeStr } = utcToLocalDateAndTimeInTz(new Date(), companyTimezone);
                const timeEl = document.getElementById('manual-punch-time');
                if (dateStr) setManualPunchDateValue(dateStr);
                if (timeEl && timeStr) timeEl.value = timeStr.slice(0, 5);
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
    const range = getReportRangeSelection();

    if (!range) {
        showMessage('Please select a valid custom date range.', 'error');
        return;
    }

    applyReportRangeToInputs(range);
    updateReportRangeLabel(range);

    const startDate = range.startDate;
    const endDate = range.endDate;
    
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

function formatReportHours(hours) {
    return Number(hours || 0).toFixed(2);
}

/** Decimal hours → H:MM (e.g. 7.95 → "7:57", 36.75 → "36:45"). */
function formatHoursAsHMM(hours) {
    const h = Number(hours) || 0;
    let wholeHours = Math.floor(h);
    let minutes = Math.round((h - wholeHours) * 60);
    if (minutes === 60) {
        wholeHours += 1;
        minutes = 0;
    }
    return `${wholeHours}:${String(minutes).padStart(2, '0')}`;
}

/** M/D/YYYY for timesheet Work Date column. */
function formatShortDate(dateStr) {
    const s = String(dateStr || '').trim().slice(0, 10);
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${Number(m)}/${Number(d)}/${y}`;
}

function formatTimeOnly(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
        timeZone: companyTimezone || 'UTC',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function getDayPunchCell(day, type) {
    const punches = [...(day.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
    const match = punches.find((p) => p.type === type);
    if (!match) return '';
    const timeText = formatTimeOnly(match.time);
    if (match.approval_status === 'pending') {
        return `<span class="timesheet-time-stack"><span class="timesheet-time-value">${timeText}</span><span class="pending-flag" title="Pending manager approval">Pending</span></span>`;
    }
    return timeText;
}

function getDayNotes(day) {
    return (day.punches || [])
        .filter((p) => p.notes)
        .map((p) => p.notes)
        .join('; ');
}

function dayHasPendingApproval(day) {
    return (day.punches || []).some((p) => p.approval_status === 'pending');
}

function buildTimesheetRow(day) {
    const notes = getDayNotes(day);
    const pendingClass = dayHasPendingApproval(day) ? ' timesheet-pending-cell' : '';
    return `
        <tr class="${pendingClass.trim()}">
            <td>${formatShortDate(day.date)}</td>
            <td>${getDayPunchCell(day, 'clock_in')}</td>
            <td>${getDayPunchCell(day, 'lunch_out')}</td>
            <td>${getDayPunchCell(day, 'lunch_in')}</td>
            <td>${getDayPunchCell(day, 'clock_out')}</td>
            <td class="timesheet-hours">${formatHoursAsHMM(day.hours)}</td>
            <td class="timesheet-notes">${notes ? escapeHtml(notes) : ''}</td>
        </tr>
    `;
}

function buildEmployeeTimesheet(emp) {
    const days = Object.values(emp.days)
        .filter((day) => day.punches && day.punches.length > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    const rowsHtml = days.length
        ? days.map(buildTimesheetRow).join('')
        : '<tr><td colspan="7" class="timesheet-empty">No punches in this period</td></tr>';

    return `
        <section class="timesheet-employee">
            <h3 class="timesheet-employee-name">${escapeHtml(emp.employee_name)}</h3>
            <div class="timesheet-scroll">
            <table class="timesheet-table">
                <colgroup>
                    <col class="col-date">
                    <col class="col-time">
                    <col class="col-time">
                    <col class="col-time">
                    <col class="col-time">
                    <col class="col-hours">
                    <col class="col-notes">
                </colgroup>
                <thead>
                    <tr>
                        <th><span class="th-full">Work Date</span><span class="th-short">Date</span></th>
                        <th><span class="th-full">Time In</span><span class="th-short">In</span></th>
                        <th><span class="th-full">Lunch Out</span><span class="th-short">L Out</span></th>
                        <th><span class="th-full">Lunch In</span><span class="th-short">L In</span></th>
                        <th><span class="th-full">Time Out</span><span class="th-short">Out</span></th>
                        <th><span class="th-full">Total Hrs</span><span class="th-short">Hrs</span></th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="5"></td>
                        <td class="timesheet-grand-total">${formatHoursAsHMM(emp.total_hours)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
            </div>
        </section>
    `;
}

function displayReport(reportData) {
    const container = document.getElementById('report-results');
    const printBtn = document.getElementById('print-report-btn');
    const startDate = document.getElementById('report-start-date')?.value || '';
    const endDate = document.getElementById('report-end-date')?.value || '';
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
    
    if (printBtn) printBtn.style.display = 'inline-block';
    const emailBtn = document.getElementById('email-report-btn');
    if (emailBtn) emailBtn.style.display = 'inline-block';

    const sheetsHtml = reportData.map(buildEmployeeTimesheet).join('');
    
    container.innerHTML = `
        <div class="timesheet-header">
            <h2 class="timesheet-title">Time Sheet</h2>
            <div class="timesheet-dates">
                <span><strong>Start Date</strong> ${formatShortDate(startDate)}</span>
                <span><strong>End Date</strong> ${formatShortDate(endDate)}</span>
            </div>
        </div>
        ${sheetsHtml}
    `;
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
            <title>Time Sheet</title>
            <style>
                @media print {
                    @page { margin: 1cm; }
                    body { margin: 0; padding: 12px; }
                }
                body {
                    font-family: Arial, Helvetica, sans-serif;
                    margin: 0;
                    padding: 16px;
                    color: #000;
                    font-size: 13px;
                }
                .timesheet-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #000;
                    padding-bottom: 8px;
                }
                .timesheet-title {
                    margin: 0;
                    font-size: 22px;
                    font-weight: bold;
                }
                .timesheet-dates span { margin-left: 20px; }
                .timesheet-employee { margin-bottom: 24px; page-break-inside: avoid; }
                .timesheet-employee-name {
                    margin: 0 0 6px;
                    font-size: 15px;
                    font-weight: bold;
                }
                .timesheet-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                    table-layout: fixed;
                }
                .timesheet-table col.col-date { width: 78px; }
                .timesheet-table col.col-time { width: 72px; }
                .timesheet-table col.col-hours { width: 52px; }
                .timesheet-table th,
                .timesheet-table td {
                    border: 1px solid #ccc;
                    padding: 4px 5px;
                    text-align: left;
                    vertical-align: top;
                }
                .timesheet-table th:nth-child(2),
                .timesheet-table th:nth-child(3),
                .timesheet-table th:nth-child(4),
                .timesheet-table th:nth-child(5),
                .timesheet-table td:nth-child(2),
                .timesheet-table td:nth-child(3),
                .timesheet-table td:nth-child(4),
                .timesheet-table td:nth-child(5) {
                    padding: 4px 2px;
                    font-size: 11px;
                    white-space: nowrap;
                    text-align: center;
                }
                .timesheet-table th {
                    background: #f5f5f5;
                    font-weight: bold;
                    font-size: 10px;
                    white-space: nowrap;
                }
                .timesheet-table th:nth-child(6) {
                    font-size: 11px;
                    white-space: normal;
                    text-align: center;
                    line-height: 1.15;
                }
                .timesheet-hours { text-align: center; white-space: nowrap; font-size: 12px; }
                .timesheet-grand-total {
                    color: #c00;
                    font-weight: bold;
                    text-align: center;
                    font-size: 12px;
                }
                .timesheet-notes {
                    font-size: 11px;
                    color: #444;
                    word-wrap: break-word;
                    overflow-wrap: anywhere;
                }
                .timesheet-empty { text-align: center; color: #666; font-style: italic; }
                .print-footer {
                    margin-top: 20px;
                    padding-top: 8px;
                    border-top: 1px solid #ccc;
                    text-align: center;
                    color: #666;
                    font-size: 11px;
                }
            </style>
        </head>
        <body>
            ${reportHTML}
            <div class="print-footer">
                <p>Generated ${new Date().toLocaleString()} · ${selectedEmployee === 'All Employees' ? 'All Employees' : escapeHtml(selectedEmployee)}</p>
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
    const s = String(dateStr || '').trim().slice(0, 10);
    if (!s) return '';
    const zone = companyTimezone || 'UTC';
    const ref = instantOnLocalDate(s, zone);
    return ref.toLocaleDateString('en-US', {
        timeZone: zone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
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

    const myClockNavBtn = document.getElementById('manager-my-clock-btn');
    if (myClockNavBtn) {
        myClockNavBtn.classList.toggle('active', tabName === 'my-clock');
    }

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    tabContent.classList.add('active');
    
    // Load My Clock when switching to that tab
    if (tabName === 'my-clock') {
        loadMyClockState();
    }
    if (tabName === 'pending-corrections') {
        loadPendingCorrections();
    }
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
            const tz = (data.timezone && String(data.timezone).trim()) ? data.timezone : 'UTC';
            companyTimezone = tz;
            const tzSelect = document.getElementById('company-timezone');
            if (tzSelect) {
                tzSelect.value = tz;
                if (!tzSelect.querySelector(`option[value="${tz}"]`)) {
                    const opt = document.createElement('option');
                    opt.value = tz;
                    opt.textContent = tz;
                    tzSelect.appendChild(opt);
                    tzSelect.value = tz;
                }
            }
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
            loadCompanyAdminEmployeeDropdown(data.company_admin_employee_id || null);
            applyCompanyPayWeekFromSettings(data);
            applyCompanyTwilioFromSettings(data);
        })
        .catch(err => {
            console.error('Error loading company settings:', err);
        });
}

/** Add one Name + Phone row to the punch notification list. */
function addNotifyRecipientRow(name = '', phone = '') {
    const rowsEl = document.getElementById('company-notify-recipients-rows');
    if (!rowsEl) return;
    const row = document.createElement('div');
    row.className = 'notify-recipient-row';
    row.innerHTML = `
        <input type="text" class="notify-recipient-name" placeholder="Name" autocomplete="off">
        <input type="tel" class="notify-recipient-phone" placeholder="9415551234" autocomplete="off">
        <button type="button" class="btn btn-danger btn-small notify-recipient-delete">Delete</button>
    `;
    row.querySelector('.notify-recipient-name').value = name || '';
    row.querySelector('.notify-recipient-phone').value = phone || '';
    rowsEl.appendChild(row);
    updateNotifyRecipientsEmptyState();
}

function updateNotifyRecipientsEmptyState() {
    const rowsEl = document.getElementById('company-notify-recipients-rows');
    const emptyEl = document.getElementById('company-notify-recipients-empty');
    if (!rowsEl || !emptyEl) return;
    emptyEl.classList.toggle('hidden', rowsEl.children.length > 0);
}

function renderNotifyRecipients(recipients) {
    const rowsEl = document.getElementById('company-notify-recipients-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    (Array.isArray(recipients) ? recipients : []).forEach((r) => {
        addNotifyRecipientRow(r?.name || '', r?.phone || '');
    });
    updateNotifyRecipientsEmptyState();
}

function collectNotifyRecipients() {
    const rowsEl = document.getElementById('company-notify-recipients-rows');
    if (!rowsEl) return [];
    return Array.from(rowsEl.querySelectorAll('.notify-recipient-row'))
        .map((row) => ({
            name: row.querySelector('.notify-recipient-name')?.value?.trim() || '',
            phone: row.querySelector('.notify-recipient-phone')?.value?.trim() || '',
        }))
        .filter((r) => r.name || r.phone);
}

function applyCompanyTwilioFromSettings(data) {
    const sidEl = document.getElementById('company-twilio-account-sid');
    const tokenEl = document.getElementById('company-twilio-auth-token');
    const fromEl = document.getElementById('company-twilio-phone-number');
    const baseUrlEl = document.getElementById('company-public-base-url');
    const statusEl = document.getElementById('company-twilio-status');
    const hintEl = document.getElementById('company-twilio-auth-token-hint');
    if (!sidEl && !statusEl) return;
    if (data.twilio_account_sid !== undefined && sidEl) sidEl.value = data.twilio_account_sid || '';
    if (data.twilio_phone_number !== undefined && fromEl) fromEl.value = data.twilio_phone_number || '';
    if (data.twilio_notify_recipients !== undefined) renderNotifyRecipients(data.twilio_notify_recipients);
    if (data.public_base_url !== undefined && baseUrlEl) baseUrlEl.value = data.public_base_url || '';
    if (tokenEl) tokenEl.value = '';
    const tokenConfigured = !!data.twilio_auth_token_configured;
    if (hintEl) {
        hintEl.textContent = tokenConfigured
            ? 'Auth token is saved. Enter a new value only to change it; leave blank to keep the existing token.'
            : 'Leave blank when saving to keep the existing token.';
    }
    if (statusEl) {
        if (data.twilio_sms_configured) {
            statusEl.textContent = 'SMS: configured for this company (Account SID, auth token, and From number).';
            statusEl.style.color = '#2e7d32';
        } else if (data.twilio_account_sid || data.twilio_phone_number || tokenConfigured) {
            statusEl.textContent = 'SMS: partially configured — complete Account SID, auth token, and From number, or rely on server TWILIO_* env vars for missing fields.';
            statusEl.style.color = '#b45309';
        } else {
            statusEl.textContent = 'SMS: not configured in Company Settings. Server TWILIO_* environment variables will be used if set.';
            statusEl.style.color = '#666';
        }
    }
}

function loadCompanyAdminEmployeeDropdown(selectedEmployeeId) {
    const sel = document.getElementById('company-admin-employee');
    if (!sel) return;
    sel.innerHTML = '<option value="">— None —</option>';
    fetch(`${API_BASE}/employees`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const list = Array.isArray(data) ? data : [];
            list.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id || emp._id;
                opt.textContent = (emp.name || 'Employee') + (emp.employee_number ? ` (# ${emp.employee_number})` : '');
                sel.appendChild(opt);
            });
            if (selectedEmployeeId) sel.value = String(selectedEmployeeId);
        })
        .catch(() => {});
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
                loadProfileLinkEmployeeDropdown(data.employee_id);
            }
        })
        .catch(err => {
            console.error('Error loading profile:', err);
            msgEl.textContent = err.message || 'Could not load profile.';
            msgEl.style.color = 'red';
        });
}

function loadProfileLinkEmployeeDropdown(selectedEmployeeId) {
    const sel = document.getElementById('profile-link-employee');
    if (!sel) return;
    sel.innerHTML = '<option value="">— None —</option>';
    fetch(`${API_BASE}/employees`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const list = Array.isArray(data) ? data : [];
            list.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id || emp._id;
                opt.textContent = (emp.name || 'Employee') + (emp.employee_number ? ' (# ' + emp.employee_number + ')' : '');
                sel.appendChild(opt);
            });
            if (selectedEmployeeId) sel.value = selectedEmployeeId;
        })
        .catch(() => {});
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
    const linkEmployeeId = document.getElementById('profile-link-employee')?.value?.trim() || '';
    body.link_employee_id = linkEmployeeId || null;

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
                    if (data.employee_id !== undefined) currentUser.employee_id = data.employee_id || null;
                }
                updateManagerNavTitle();
                document.getElementById('profile-new-password').value = '';
                document.getElementById('profile-confirm-password').value = '';
                loadManagerProfile();
                loadMyClockState();
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
    const companyAdminEmployeeId = document.getElementById('company-admin-employee')?.value?.trim() || '';
    const timezone = document.getElementById('company-timezone')?.value?.trim() || 'UTC';
    const payWeekStart = parseInt(document.getElementById('pay-week-start')?.value, 10);
    const payWeekEnd = parseInt(document.getElementById('pay-week-end')?.value, 10);
    const twilioAccountSid = document.getElementById('company-twilio-account-sid')?.value?.trim() || '';
    const twilioAuthToken = document.getElementById('company-twilio-auth-token')?.value?.trim() || '';
    const twilioPhoneNumber = document.getElementById('company-twilio-phone-number')?.value?.trim() || '';
    const twilioNotifyRecipients = collectNotifyRecipients();
    const publicBaseUrl = document.getElementById('company-public-base-url')?.value?.trim() || '';
    const messageDiv = document.getElementById('company-settings-message');
    if (!companyName) {
        if (messageDiv) messageDiv.innerHTML = '<p style="color: red;">Company name is required</p>';
        return;
    }
    fetch(`${API_BASE}/company-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            company_name: companyName,
            logo_data: logoData || null,
            company_admin_employee_id: companyAdminEmployeeId || null,
            timezone,
            pay_week_start_day: Number.isNaN(payWeekStart) ? 1 : payWeekStart,
            pay_week_end_day: Number.isNaN(payWeekEnd) ? 0 : payWeekEnd,
            twilio_account_sid: twilioAccountSid,
            twilio_phone_number: twilioPhoneNumber,
            twilio_notify_recipients: twilioNotifyRecipients,
            public_base_url: publicBaseUrl,
            ...(twilioAuthToken ? { twilio_auth_token: twilioAuthToken } : {}),
        }),
        credentials: 'include'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                if (data.timezone) companyTimezone = data.timezone;
                if (data.pay_week_start_day !== undefined && data.pay_week_start_day !== null) {
                    companyPayWeekStartDay = data.pay_week_start_day;
                    companyPayWeekEndDay = data.pay_week_end_day;
                }
                applyCompanyTwilioFromSettings(data);
                const tokenEl = document.getElementById('company-twilio-auth-token');
                if (tokenEl) tokenEl.value = '';
                const tzLabel = document.getElementById('company-timezone')?.selectedOptions?.[0]?.textContent
                    || data.timezone
                    || 'UTC';
                if (messageDiv) {
                    messageDiv.innerHTML = `<p style="color: green;">Company settings saved. Timezone: <strong>${tzLabel}</strong>. Punch times and reports will use this timezone.</p>`;
                }
                updateLoginPageTitle(data.company_name);
                loadManagerNavCompanyName();
                refreshTimezoneDependentViews();
            } else {
                if (messageDiv) messageDiv.innerHTML = `<p style="color: red;">${data.error || 'Failed to save settings'}</p>`;
            }
        })
        .catch(err => {
            console.error('Error saving company settings:', err);
            if (messageDiv) messageDiv.innerHTML = '<p style="color: red;">Error saving settings. Please try again.</p>';
        });
}

function updateEmployeePageTitle() {
    const el = document.getElementById('employee-page-title');
    if (!el) return;
    fetch(`${API_BASE}/company-settings`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const companyName = (data && data.company_name && String(data.company_name).trim()) ? data.company_name.trim() : 'MVC';
            el.textContent = `${companyName} Time Clock`;
        })
        .catch(() => { el.textContent = 'MVC Time Clock'; });
}

function updateLoginPageTitle(companyName) {
    const loginTitle = document.querySelector('#login-page h1');
    const pageTitle = document.querySelector('title');
    const employeePageTitle = document.getElementById('employee-page-title');

    if (loginTitle) {
        loginTitle.textContent = `${companyName} Time Clock`;
    }
    if (pageTitle) {
        pageTitle.textContent = `${companyName} Time Clock`;
    }
    if (employeePageTitle) {
        employeePageTitle.textContent = `${companyName} Time Clock`;
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

/** Get YYYY-MM-DD for a UTC date in the given timezone (or company timezone). */
function getLocalDateStringInTz(date, tz) {
    const d = new Date(date);
    const zone = (tz && String(tz).trim()) || companyTimezone || 'UTC';
    return d.toLocaleDateString('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Format date+time for display in the given timezone (or company timezone). */
function formatDateTimeInTz(date, tz) {
    const d = new Date(date);
    const zone = (tz && String(tz).trim()) || companyTimezone || 'UTC';
    return d.toLocaleString('en-US', {
        timeZone: zone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDateTime(date) {
    return formatDateTimeInTz(date, companyTimezone);
}

/** Split a UTC instant into YYYY-MM-DD and HH:MM:SS in the company (or given) timezone. */
function utcToLocalDateAndTimeInTz(utcDate, timezone) {
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const d = new Date(utcDate);
    if (Number.isNaN(d.getTime())) return { dateStr: '', timeStr: '' };
    const dateStr = d.toLocaleDateString('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '00';
    const timeStr = `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}:${get('second').padStart(2, '0')}`;
    return { dateStr, timeStr };
}

/** Parse YYYY-MM-DD + HH:mm(:ss) as company-local wall time → UTC Date. */
function localDateTimeInTzToUtc(localDateStr, timeStr, timezone) {
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const dateStr = String(localDateStr || '').trim().slice(0, 10);
    const targetTime = normalizeLocalTimeInput(timeStr);
    if (!dateStr || !targetTime) return null;

    const start = getStartOfLocalDayInstant(dateStr, zone);
    for (let min = 0; min < 24 * 60; min++) {
        const d = new Date(start.getTime() + min * 60 * 1000);
        if (getLocalDateStringInTz(d, zone) !== dateStr) continue;
        const local = utcToLocalDateAndTimeInTz(d, zone);
        if (local.dateStr === dateStr && local.timeStr === targetTime) return d;
    }
    return null;
}

function normalizeLocalTimeInput(timeStr) {
    let raw = String(timeStr || '').trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    const isPm = /\bPM\b/.test(upper) || upper.endsWith('PM');
    const isAm = /\bAM\b/.test(upper) || upper.endsWith('AM');
    raw = raw.replace(/\s*(AM|PM)\s*$/i, '').trim();
    const parts = raw.split(':');
    if (parts.length < 2) return null;
    let hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    const ss = parseInt(String(parts[2] || '0').replace(/\D/g, ''), 10);
    if ([hh, mm, ss].some((n) => Number.isNaN(n))) return null;
    if (isPm && hh < 12) hh += 12;
    if (isAm && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function getStartOfLocalDayInstant(localDateStr, timezone) {
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const s = String(localDateStr || '').trim().slice(0, 10);
    const base = new Date(s + 'T12:00:00.000Z').getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    let startUtc = null;
    for (let offset = -dayMs; offset <= dayMs; offset += 15 * 60 * 1000) {
        const T = new Date(base + offset);
        if (getLocalDateStringInTz(T, zone) === s) {
            if (startUtc == null || T < startUtc) startUtc = T;
        }
    }
    return startUtc || instantOnLocalDate(s, zone);
}

function formatDatePickerLabel(yyyyMmDd) {
    const s = String(yyyyMmDd || '').trim().slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 'Select date';
    return `${m[2]}/${m[3]}/${m[1]}`;
}

function parseYmdParts(yyyyMmDd) {
    const s = String(yyyyMmDd || '').trim().slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {
        year: parseInt(m[1], 10),
        month: parseInt(m[2], 10) - 1,
        day: parseInt(m[3], 10),
    };
}

function ymdFromParts(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayYmdPartsInCompanyTz() {
    try {
        const now = utcToLocalDateAndTimeInTz(new Date(), companyTimezone);
        const parts = parseYmdParts(now.dateStr);
        if (parts) return parts;
    } catch (_) { /* fallback below */ }
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/** Registry: hidden input id → picker controller */
const customDatePickers = Object.create(null);

function closeAllCustomDatePickers(exceptRootId) {
    Object.keys(customDatePickers).forEach((inputId) => {
        const p = customDatePickers[inputId];
        if (!p) return;
        if (exceptRootId && p.rootId === exceptRootId) return;
        p.close();
    });
}

function syncDateInputUi(inputId) {
    const picker = customDatePickers[inputId];
    if (picker) picker.syncFromInput();
}

function setDateInputValue(inputId, yyyyMmDd, options) {
    const value = String(yyyyMmDd || '').slice(0, 10);
    const picker = customDatePickers[inputId];
    if (picker) {
        picker.setValue(value, options);
        return;
    }
    const el = document.getElementById(inputId);
    if (!el) return;
    el.value = value;
    if (options?.dispatchChange) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function createCustomDatePicker(prefix) {
    const root = document.getElementById(`${prefix}-datepicker`);
    const inputId = root?.dataset?.dateInput;
    if (!root || !inputId || root.dataset.ready === '1') return null;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return null;

    const trigger = document.getElementById(`${prefix}-datepicker-trigger`);
    const label = document.getElementById(`${prefix}-datepicker-label`);
    const panel = document.getElementById(`${prefix}-datepicker-panel`);
    const monthSel = document.getElementById(`${prefix}-cal-month`);
    const yearSel = document.getElementById(`${prefix}-cal-year`);
    const prevBtn = document.getElementById(`${prefix}-cal-prev`);
    const nextBtn = document.getElementById(`${prefix}-cal-next`);
    const grid = document.getElementById(`${prefix}-cal-grid`);
    if (!trigger || !panel || !monthSel || !yearSel || !grid) return null;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (!monthSel.options.length) {
        months.forEach((name, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = name;
            monthSel.appendChild(opt);
        });
    }
    if (!yearSel.options.length) {
        const nowYear = new Date().getFullYear();
        for (let y = nowYear - 5; y <= nowYear + 5; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            yearSel.appendChild(opt);
        }
    }

    function syncLabel() {
        if (label) label.textContent = formatDatePickerLabel(inputEl.value);
    }

    function render(year, monthIndex) {
        const first = new Date(year, monthIndex, 1);
        const startWeekday = first.getDay();
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const daysInPrev = new Date(year, monthIndex, 0).getDate();
        const selectedYmd = inputEl.value || '';
        const cells = [];

        for (let i = 0; i < 42; i++) {
            let cellYear = year;
            let cellMonth = monthIndex;
            let cellDay;
            let muted = false;

            if (i < startWeekday) {
                cellDay = daysInPrev - startWeekday + i + 1;
                cellMonth = monthIndex - 1;
                if (cellMonth < 0) {
                    cellMonth = 11;
                    cellYear = year - 1;
                }
                muted = true;
            } else if (i >= startWeekday + daysInMonth) {
                cellDay = i - startWeekday - daysInMonth + 1;
                cellMonth = monthIndex + 1;
                if (cellMonth > 11) {
                    cellMonth = 0;
                    cellYear = year + 1;
                }
                muted = true;
            } else {
                cellDay = i - startWeekday + 1;
            }

            const ymd = ymdFromParts(cellYear, cellMonth, cellDay);
            cells.push(
                `<button type="button" class="custom-datepicker-day${muted ? ' muted' : ''}${ymd === selectedYmd ? ' selected' : ''}" data-date="${ymd}">${cellDay}</button>`
            );
        }
        grid.innerHTML = cells.join('');
    }

    function ensureYearOption(year) {
        if (![...yearSel.options].some((o) => o.value === String(year))) {
            const opt = document.createElement('option');
            opt.value = String(year);
            opt.textContent = String(year);
            yearSel.appendChild(opt);
        }
    }

    function showMonth(year, monthIndex) {
        ensureYearOption(year);
        monthSel.value = String(monthIndex);
        yearSel.value = String(year);
        render(year, monthIndex);
    }

    function close() {
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function open() {
        closeAllCustomDatePickers(root.id);
        let parts = parseYmdParts(inputEl.value) || todayYmdPartsInCompanyTz();
        showMonth(parts.year, parts.month);
        panel.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function toggle() {
        if (panel.classList.contains('hidden')) open();
        else close();
    }

    function setValue(yyyyMmDd, options) {
        inputEl.value = String(yyyyMmDd || '').slice(0, 10);
        syncLabel();
        const parts = parseYmdParts(inputEl.value);
        if (parts && !panel.classList.contains('hidden')) {
            showMonth(parts.year, parts.month);
        }
        if (options?.dispatchChange) {
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function syncFromInput() {
        syncLabel();
    }

    function shiftMonth(delta) {
        let month = parseInt(monthSel.value, 10);
        let year = parseInt(yearSel.value, 10);
        if (Number.isNaN(month) || Number.isNaN(year)) {
            const d = todayYmdPartsInCompanyTz();
            month = d.month;
            year = d.year;
        }
        month += delta;
        if (month < 0) {
            month = 11;
            year -= 1;
        } else if (month > 11) {
            month = 0;
            year += 1;
        }
        showMonth(year, month);
    }

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
    });
    prevBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        shiftMonth(-1);
    });
    nextBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        shiftMonth(1);
    });
    monthSel.addEventListener('change', () => {
        render(parseInt(yearSel.value, 10), parseInt(monthSel.value, 10));
    });
    yearSel.addEventListener('change', () => {
        render(parseInt(yearSel.value, 10), parseInt(monthSel.value, 10));
    });
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.custom-datepicker-day');
        if (!btn) return;
        const date = btn.dataset.date;
        if (!date) return;
        setValue(date, { dispatchChange: true });
        close();
    });

    setTimeout(() => {
        document.addEventListener('click', (e) => {
            if (panel.classList.contains('hidden')) return;
            if (root.contains(e.target)) return;
            close();
        });
    }, 0);

    syncLabel();
    root.dataset.ready = '1';

    const controller = {
        rootId: root.id,
        inputId,
        setValue,
        syncFromInput,
        close,
        open,
    };
    customDatePickers[inputId] = controller;
    return controller;
}

function initAllCustomDatePickers() {
    ['manual-punch', 'edit-punches', 'report-start', 'report-end',
        'employee-history-start', 'employee-history-end', 'emp-hire'].forEach(createCustomDatePicker);
}

function setManualPunchDateValue(yyyyMmDd) {
    setDateInputValue('manual-punch-date', yyyyMmDd);
}

function setManualPunchDefaultsToCompanyNow() {
    const { dateStr, timeStr } = utcToLocalDateAndTimeInTz(new Date(), companyTimezone);
    const manualDateEl = document.getElementById('manual-punch-date');
    const manualTimeEl = document.getElementById('manual-punch-time');
    if (dateStr && (!manualDateEl?.value)) setManualPunchDateValue(dateStr);
    else if (manualDateEl?.value) syncDateInputUi('manual-punch-date');
    if (manualTimeEl && !manualTimeEl.value && timeStr) manualTimeEl.value = timeStr.slice(0, 5);
}

/** Find a UTC instant that falls on localDateStr in the given IANA timezone. */
function instantOnLocalDate(localDateStr, timezone) {
    const s = String(localDateStr || '').trim().slice(0, 10);
    const zone = (timezone && String(timezone).trim()) || companyTimezone || 'UTC';
    const base = new Date(s + 'T12:00:00.000Z').getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let offset = -dayMs; offset <= dayMs; offset += 60 * 60 * 1000) {
        const d = new Date(base + offset);
        if (getLocalDateStringInTz(d, zone) === s) return d;
    }
    return new Date(s + 'T12:00:00.000Z');
}

function formatDate(dateStr) {
    const s = String(dateStr || '').trim().slice(0, 10);
    if (!s) return '';
    const zone = companyTimezone || 'UTC';
    const ref = instantOnLocalDate(s, zone);
    return ref.toLocaleDateString('en-US', {
        timeZone: zone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    });
}

function showMessage(message, type = 'success') {
    const messageDiv = document.getElementById('message');
    if (messageDiv) {
        messageDiv.textContent = message;
        messageDiv.className = `message ${type}`;
        messageDiv.classList.remove('hidden');
        setTimeout(() => {
            messageDiv.classList.add('hidden');
        }, 5000);
    } else {
        alert(message);
    }
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

// Make employee/punch actions available globally (for inline onclick from cards/modals)
window.openTerminateEmployeeModal = openTerminateEmployeeModal;
window.editEmployee = editEmployee;
window.openGrantManagerModal = openGrantManagerModal;
window.openGrantManagerModalFromEditModal = openGrantManagerModalFromEditModal;
window.revokeManagerRights = revokeManagerRights;
window.revokeManagerRightsFromEditModal = revokeManagerRightsFromEditModal;
window.editPunch = editPunch;
window.deletePunch = deletePunch;

// Start after the whole script has evaluated (avoids TDZ on const/let used during setup)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

