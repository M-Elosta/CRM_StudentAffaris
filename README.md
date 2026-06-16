# ERO System — CMU-Q Employer Relations Office

A web application for managing company relationships, contacts, outreach, recruitment, events, and internship records.

**Stack:** Node.js · Express · SQLite · Bootstrap 5 · Chart.js

---

## Quick Start

### Prerequisites
- Node.js 18 or later

### First-Time Setup

```bash
cd employer-system
npm install
node database/seed.js   # optional — loads sample data
export SESSION_SECRET="$(openssl rand -hex 32)"
export DEFAULT_ADMIN_PASSWORD="change-this-before-sharing"
node server.js
```

Open your browser to **http://localhost:3000**

On first start, the app creates the bootstrap admin from:

- `DEFAULT_ADMIN_USERNAME` (optional, defaults to `admin`)
- `DEFAULT_ADMIN_PASSWORD` (**required in production**)

If `SESSION_SECRET` is not set in development, the server generates a temporary secret for that run only.

### Convenience Scripts

| OS | Command |
|----|---------|
| Mac / Linux | `bash scripts/start.sh` |
| Windows | `scripts\start.bat` |

Both scripts auto-install dependencies and seed the database on first run.

---

## Pages

| Page | URL |
|------|-----|
| Dashboard | `/index.html` |
| Companies | `/pages/companies.html` |
| Contacts | `/pages/contacts.html` |
| Outreach & Engagement | `/pages/outreach.html` |
| Recruitment | `/pages/recruitment.html` |
| Career Events | `/pages/career-events.html` |
| Student-Led Events | `/pages/student-events.html` |
| Academic Engagement | `/pages/academic.html` |
| Hiring Feedback | `/pages/hiring-feedback.html` |
| Potential Collaboration | `/pages/collaboration.html` |
| Reports | `/pages/reports.html` |
| Data Import | `/pages/import.html` |

---

## Importing Data

1. Go to **Data Import** in the sidebar.
2. Select the entity type and upload an Excel (.xlsx) or CSV file.
3. Map your columns to the system fields (auto-matched where possible).
4. Review the validation results — duplicates and errors are flagged per row.
5. Choose to insert, update, or skip each row, then click **Confirm Import**.

**Download a blank template** for any entity from the Import page.

---

## Reports & Export

Go to **Reports**, choose a report type, optionally set a date range, then:
- **Preview** — renders results in the page
- **Export** — downloads an Excel (.xlsx) file

Report types include: mailable contacts, event invitation list, resume book, follow-up reminders, engagement summary, recruitment activity, career events, hiring outcomes, and job outreach.

---

## Backing Up Data

The database is a single file: `employer-system/data/employer.db`

**Manual backup:** copy that file to a safe location.

**Automated backup (keeps last 10):**
```bash
node employer-system/scripts/backup.js
```
Backups are saved to `employer-system/data/backups/`.

---

## Changing Your Password

Click **Change Password** at the bottom of the sidebar (available from any page after login).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 3000 already in use | Kill the other process or change `PORT` in `server.js` |
| Forgot password | Reset the affected user directly in the database, or start a fresh dev database with a new `DEFAULT_ADMIN_PASSWORD` |
| Blank dashboard charts | Make sure the database has data; run `node database/seed.js` to load samples |
| Import fails validation | Download the entity template from the Import page to see expected column names |

---

## Technical Notes

- **Framework:** Express 4, Node.js
- **Database:** SQLite via `better-sqlite3` (`data/employer.db`)
- **Auth:** `express-session` + `bcrypt`, rate-limited to 10 login attempts per 15 min, `SameSite=Lax`, `HttpOnly`, and `Secure` cookies in production
- **Port:** 3000 (configurable via `PORT` env var)
- **Required for production:** `SESSION_SECRET` and `DEFAULT_ADMIN_PASSWORD`
- **No build step** — vanilla HTML/CSS/JS, Bootstrap 5 and Chart.js loaded from CDN
- **Route files:** `employer-system/routes/` — one file per entity
- **Schema:** `employer-system/database/schema.sql`
