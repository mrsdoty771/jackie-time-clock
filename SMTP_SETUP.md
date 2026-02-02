# Fix "Email sending is not configured"

To use **Email Report** (send the weekly report as a PDF by email), the server needs SMTP credentials in a `.env` file.

## Steps

### 1. Create or open `.env`

In the **project root** (same folder as `server.js`), create a file named `.env` if it doesn’t exist.  
You can copy from the example:

- **Windows (PowerShell):** `Copy-Item .env.example .env`
- **Mac/Linux:** `cp .env.example .env`

Then open `.env` in your editor.

### 2. Add these lines (Office 365 / myvaluecars.com)

Use your **real** Office 365 email and password. Replace the placeholders:

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-actual-email@myvaluecars.com
SMTP_PASS=your-actual-office365-password
SMTP_FROM=your-actual-email@myvaluecars.com
```

- **SMTP_USER** – Your full Office 365 email (e.g. `admin@myvaluecars.com`).
- **SMTP_PASS** – The password you use to sign in to Outlook/Office 365 for that account.
- **SMTP_FROM** – Usually the same as `SMTP_USER`.

Use the **same** email and password you use to log in to Outlook on the web or the Outlook app.

### 3. Save `.env` and restart the server

- Save the `.env` file.
- Stop the Node server (Ctrl+C in the terminal).
- Start it again: `npm start`.

### 4. Try Email Report again

In the app: Reports tab → Generate Report → **Email Report** → enter the recipient and send.

---

**Note:** Your profile email in **My Account** is used as the “From” address when set; the server still uses `SMTP_USER` and `SMTP_PASS` from `.env` to sign in to the mail server.

**Do not commit `.env`** — it contains your password and is listed in `.gitignore`.
