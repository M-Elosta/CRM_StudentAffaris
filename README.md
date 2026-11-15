# Employer Relations System

Employer Relations System is a Node.js + SQLite web app for tracking employer relationships in one place. It helps teams manage companies, contacts, outreach, recruitment activity, events, and reports through a simple browser-based interface.

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
- **Database:** SQLite via `better-sqlite3`
- **Frontend:** Static HTML, Bootstrap, vanilla JavaScript, Chart.js
- **Exports:** Excel via `exceljs`

## How to run it

Requires Node.js 22.

```bash
npm ci
```

```bash
npm run seed:demo
```

```bash
npm start
```

Open `http://127.0.0.1:3000`. The first start prints the administrator username and a generated password. In development the database is created at `data/dev/employer.db`. Copy `.env.example` to `.env` to change settings.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/server.js` | Entry point: config, migrations, start, shutdown |
| `src/app.js` | Express application factory |
| `src/config/` | Environment-based configuration |
| `src/db/` | Connection, migrations, backups |
| `src/middleware/` | Authentication, origin check, error handling |
| `src/routes/` | API endpoints |
| `src/services/` | Business logic |
| `public/` | Static pages, client-side JS, and styles |
| `scripts/` | Migrate, backup and demo-seed commands |
| `deploy/` | Deployment files |
| `tests/` | Automated tests |

## Demo screenshots

### Dashboard

> Placeholder: add a dashboard screenshot here. Use only fake/demo data in the capture.

### Reports

> Placeholder: add a reports page screenshot here. Use only fake/demo data in the capture.

### Seeded data examples

> Placeholder: add a companies/contacts data screenshot here. Use only fake/demo data in the capture.

## Deployment notes

Deployment documentation is being written as part of the production-readiness work. See `PROGRESS.md` for status and `AUDIT.md` for the audit that started it.
