# Time Clock Application – Audit & Task List

## Audit Summary

### Codebase structure
- **Backend:** Node.js, Express, MongoDB (Mongoose). Routes under `/api`, session-based auth, multi-tenant by `companyId`.
- **Frontend:** Single-page app in `public/` – `index.html`, `app.js`, `styles.css`, `script.js`. No separate build step.
- **Layout:** `models/` (schemas), `controllers/` (logic), `routes/` (API), `middleware/` (auth, company), `utils/` (sms, encrypt).

### Core features already implemented

| Area | What's done |
|------|------------------|
| **Auth** | Login (company ID + name + password), manager vs employee vs super-admin, logout. Session with 5‑min idle timeout, 401 handling. |
| **Employee UI** | Clock in/out, lunch in/out, optional note, recent time records (grouped by day, hours). Button state (one of each punch type per day). |
| **Manager dashboard** | Tabs: My Clock, Employees, Manual Punch, Edit Employee Punches, Reports, Company Settings, My Account. |
| **My Clock (managers)** | Self punch (clock/lunch) when manager account is linked to an employee; same login (name + password). |
| **Employees** | List (active/inactive/all), add employee (with temp password), edit (name, number, email, phone, password, status), remove (soft deactivate). Grant/revoke manager rights (role upgrade; same login). |
| **Punches** | Create (employee self or manager manual), list (filter by employee, date range), get one, update, delete. Notes on punches. |
| **Reports** | Weekly report by date range and employee (or all). Hours per day, totals. Generate in UI, print, email PDF (per-manager SMTP). |
| **Company settings** | Company name, logo upload (base64). Shown on login and manager nav. |
| **My Account** | Profile (name, email, ext, password), SMTP for report emails, test email, “Use for My Clock” (link to employee). |
| **Database** | MongoDB; models: User, Employee, Punch, Company, CompanySettings. All queries scoped by `companyId`. |
| **Security** | Bcrypt passwords, requireAuth/requireCompany/requireManager, Company status (Suspended blocks API), encrypted SMTP password. |
| **Notifications** | Twilio SMS on punch (optional; env vars). |

### Critical missing pieces (for a solid time clock)

1. **Timezone handling** – Punch times are stored as `Date` (server time). There is no stored timezone per company/employee, so “today” and report boundaries can be wrong for remote or multi-location teams. Consider storing timezone (e.g. company or employee) and using it for day boundaries and display.
2. **Explicit production hardening** – README suggests but does not implement: persistent session store (e.g. `connect-mongo`), stronger SESSION_SECRET guidance, and HTTPS. Important before going live.
3. **Data backup / export** – No built-in backup or “export all my data” (e.g. punches to CSV). Relying on DB backups only; admins may want self-serve export.
4. **Audit trail** – No log of who edited/deleted a punch or when. Helpful for compliance and disputes.
5. **Tests** – No unit or API tests. Adding a few critical-path tests (e.g. punch create, report range) would reduce regressions.

### Nice-to-have (not critical)

- **LocalStorage** – e.g. “remember company ID” on login; optional.
- **Overtime** – README mentions it; not implemented (e.g. rules like >40 hrs/week).
- **CSV export** – Reports can be printed/emailed as PDF; CSV export not implemented.

---

## Done

- [x] Multi-tenant data model and API (companyId everywhere)
- [x] Employee login (select name + password) and employee time clock UI
- [x] Manager login (username + password) and manager dashboard
- [x] Clock in / clock out / lunch in / lunch out with notes
- [x] Recent time records for employees (grouped by day, total hours)
- [x] Punch button state (one of each type per day, logical order)
- [x] Employee list and add employee (with temp password)
- [x] Edit employee (name, number, email, phone, password, active)
- [x] Remove employee (soft deactivate)
- [x] Grant manager rights (upgrade role; same login, manager dashboard)
- [x] Revoke manager rights (downgrade role; same login, employee view)
- [x] My Clock tab for managers (self punch when linked to employee)
- [x] Manual punch (manager selects employee + type + notes)
- [x] Edit and delete individual punches (manager)
- [x] Weekly reports (date range, employee filter, hours per day, totals)
- [x] Print report and email report (PDF, per-manager SMTP)
- [x] Company settings (name, logo)
- [x] My Account (profile, password, SMTP, test email, link to employee for My Clock)
- [x] Session auth with idle timeout (5 min) and 401 handling
- [x] Login options (company ID, managers + employees in dropdown, super-admin)
- [x] Twilio SMS on punch (optional)
- [x] Default manager user creation from env on startup
- [x] Company status check (Suspended blocks API)

---

## Next Steps

### High priority (functional / production-ready)

1. **Timezone**
   - Add timezone (e.g. company or employee) to config.
   - Use it for “today” and report date boundaries and for display (e.g. `toLocaleString` with that timezone).

2. **Production checklist**
   - Use a strong `SESSION_SECRET` (and document in README).
   - Add a persistent session store (e.g. `connect-mongo`) so sessions survive server restarts.
   - Document or enforce HTTPS in production.

3. **Backup / export**
   - Provide a way to export data (e.g. manager: “Export punches” for a date range to CSV).
   - Document or automate DB backup for your host (e.g. DigitalOcean).

### Medium priority (reliability and compliance)

4. **Audit log**
   - Log punch edits/deletes (who, when, what changed) in a collection or file.
   - Optionally show “Last modified by / at” on punch rows or in reports.

5. **Tests**
   - Add a few API tests (e.g. Jest + supertest): e.g. POST punch, GET punches, weekly report.
   - Run tests in CI or before deploy.

### Lower priority (improvements)

6. **CSV export**
   - Add “Download CSV” next to weekly report (same data as report, CSV format).

7. **Remember company ID**
   - Save company ID in `localStorage` on login and prefill the login field.

8. **Overtime (if needed)**
   - Define rules (e.g. over 40 hrs/week) and add overtime hours to reports or a separate view.

---

*Last audit: generated from current codebase (server, controllers, models, routes, public app).*
