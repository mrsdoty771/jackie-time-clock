# Production deployment (DigitalOcean App Platform)

Local development uses a `.env` file in the project root. **That file is not deployed** (it is in `.gitignore`). On DigitalOcean, every value must be set under **App → your app → Settings → App-Level Environment Variables** (or in your App Spec), then **redeploy** so the running container picks them up.

Production URL for this app: `https://hammerhead-app-otcfa.ondigitalocean.app/`

## Required for the app to run

| Variable | Example / notes |
|----------|-----------------|
| `DATABASE_URL` | Full MongoDB connection string (e.g. DigitalOcean Managed MongoDB) |
| `SESSION_SECRET` | Long random string (not the dev default) |
| `NODE_ENV` | `production` (App Platform often sets this automatically) |

## SMS (Twilio) and login links

You can configure Twilio **per company** in the manager dashboard → **Company Settings** → **SMS (Twilio)** (recommended on DigitalOcean so secrets stay out of the app spec). Environment variables are optional and used as **fallback** for any field left empty in Company Settings.

### Option A — Company Settings (per company)

In **Company Settings**, set:

- Twilio Account SID, Auth Token, From number
- Punch notification phone (optional)
- **Public app URL** — HTTPS URL for login invite links in SMS (no trailing slash)

Precedence: **Company Settings first**, then env vars below for each missing field.

### Option B — Environment variables (server-wide fallback)

Copy values from [Twilio Console](https://console.twilio.com). Names must match **exactly** (case-sensitive).

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | Auth token (secret — mark as **SECRET** in DO if available) |
| `TWILIO_PHONE_NUMBER` | Twilio “From” number in E.164, e.g. `+15551234567` |
| `TWILIO_NOTIFY_PHONE` | Phone to receive **punch** notifications (clock in/out, lunch). Not used for login texts. |

**Login text SMS** needs Account SID, Auth Token, and From number (not `TWILIO_NOTIFY_PHONE`).

### Public URL for login invite links in SMS

| Source | Notes |
|--------|--------|
| Company Settings → **Public app URL** | Per company; preferred on DO |
| `BASE_URL` (env) | e.g. `https://hammerhead-app-otcfa.ondigitalocean.app` |

No trailing slash. Without either, “Send login text” returns a clear API error in production; punch SMS may still work if Twilio is configured.

Env alternatives for `BASE_URL`: `APP_URL`, `PUBLIC_URL`, `WEB_URL`, or `SITE_URL` (first non-empty wins).

## Recommended for production

| Variable | Purpose |
|----------|---------|
| `DEFAULT_COMPANY_ID` | Default company id for seeded managers (e.g. `MVC`) |
| `SUPER_ADMIN_COMPANY_ID` | Company id for super-admin `admin` user |
| `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` | Optional bootstrap manager |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email weekly PDF reports |

## Verify after deploy

1. Open **Runtime Logs** in DigitalOcean right after deploy.
2. Look for:
   - `[Twilio]` lines — env-based Twilio (optional if using Company Settings)
   - `[BASE_URL]` — env public URL (optional if set in Company Settings)
3. Configure Twilio and Public app URL in **Company Settings** if you prefer not to use DO env vars for SMS.

## Troubleshooting SMS on production

| Symptom | Likely cause |
|---------|----------------|
| API error mentions missing `TWILIO_*` | Set Twilio in Company Settings or `TWILIO_*` on DO; redeploy after env changes |
| API error about Public app URL / `BASE_URL` | Set **Public app URL** in Company Settings or `BASE_URL` on DO |
| Twilio auth / 20003 in logs | Wrong SID/token or extra spaces; re-copy from Twilio Console |
| Texts work locally but not on DO | Expected — configure DO env vars; `.env` is not uploaded |
| Punch texts missing but login texts work | Set `TWILIO_NOTIFY_PHONE` on DO |

Do **not** commit `.env` or paste real secrets into the repo.
