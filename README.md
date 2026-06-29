# Employer Relations System

Employer Relations System is a Node.js + PostgreSQL web app for tracking employer relationships in one place. It helps teams manage companies, contacts, outreach, recruitment activity, events, and reports through a simple browser-based interface.

> **Demo data note**
>
> The seeded dataset in this project is **fake/demo data** for development and demonstrations. Company names, contacts, reports, dashboard metrics, and screenshots should be treated as sample content only.

## What the project does

- Track employers, sectors, countries, favourites, MoU partners, and blacklisted companies.
- Manage employer contacts, mailing status, alumni flags, resume-book lists, and event-invitation lists.
- Record outreach engagements, follow-ups, recruitment opportunities, hiring outcomes, career events, academic engagements, and student-led events.
- Generate dashboard views and exportable reports, including company, contact, engagement, recruitment, and trend reports.
- Import data in bulk and manage access through authenticated user accounts.

## Main areas

| Area | What it covers |
| --- | --- |
| Dashboard | Snapshot charts for employer mix and activity |
| Companies | Employer directory and profile management |
| Contacts | Contact records, mailing flags, alumni tracking |
| Outreach | Meetings, calls, follow-ups, action items |
| Recruitment | Job, internship, and programme opportunities |
| Events | Career events, academic engagements, student-led events |
| Reports | Quick reports, charts, and Excel exports |
| Admin | Authentication and user management |

## Tech stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL via `pg`
- **Frontend:** Static HTML, Bootstrap, vanilla JavaScript, Chart.js
- **Exports:** Excel via `xlsx`

## How to run it

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure PostgreSQL connection variables (see `.env.example`).

3. Optionally seed demo data:

   ```bash
   node database/seed.js
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000` in your browser.

On a fresh database, set `DEFAULT_ADMIN_PASSWORD` before the first run if you want a predictable admin password.

## Project structure

| Path | Purpose |
| --- | --- |
| `server.js` | App entrypoint and middleware setup |
| `routes/` | API endpoints |
| `public/` | Static pages, client-side JS, and styles |
| `database/schema.sql` | PostgreSQL schema |
| `database/seed.js` | Demo data seeding |
| `scripts/` | Backup and helper scripts |
| `ops/` | Example deployment/service files |

## Demo screenshots

### Dashboard

> Placeholder: add a dashboard screenshot here. Use only fake/demo data in the capture.

### Reports

> Placeholder: add a reports page screenshot here. Use only fake/demo data in the capture.

### Seeded data examples

> Placeholder: add a companies/contacts data screenshot here. Use only fake/demo data in the capture.

## Deployment notes

- Example production environment variables are in `.env.example`.
- Example `systemd` service configuration is in `ops/employer-system.service`.
- Database backup helpers are in `scripts/backup.js` and `scripts/backup-db.sh` and use `pg_dump`.
