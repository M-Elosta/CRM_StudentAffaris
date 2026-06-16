# Employer Relations System

Web application for the CMU-Q Employer Relations Office. The app runs on Node.js, stores data in SQLite, and has no build step.

## What IT needs to know

- **App entrypoint:** `server.js`
- **Package command:** `npm start`
- **Database file:** `data/employer.db`
- **Environment template:** `.env.example`
- **Backup command:** `./scripts/backup-db.sh`
- **Service example:** `ops/employer-system.service`

## Prerequisites

- Linux server with `systemd`
- Node.js 18 or later
- npm
- A service account to run the app, for example `www-data`

## Install

```bash
cd /opt
sudo mkdir -p employer-system
sudo chown $USER:$USER employer-system
cd employer-system

# copy the repository contents here, then:
npm install
```

## Configure environment

The app does **not** auto-load a `.env` file. Use the provided template to create a system environment file:

```bash
sudo mkdir -p /etc/employer-system
sudo cp /opt/employer-system/.env.example /etc/employer-system/employer-system.env
sudo chmod 600 /etc/employer-system/employer-system.env
```

Edit `/etc/employer-system/employer-system.env` and set real values for:

- `SESSION_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- optionally `DEFAULT_ADMIN_USERNAME`
- optionally `PORT`

Example variables:

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=replace-with-a-long-random-secret
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=replace-with-a-strong-12-plus-character-password
```

## First manual run

Use one manual start before enabling the service:

```bash
cd /opt/employer-system
set -a
. /etc/employer-system/employer-system.env
set +a
npm start
```

Then open `http://SERVER_NAME:3000`.

### First login

On the first startup only, the app creates one default admin account:

- username = `DEFAULT_ADMIN_USERNAME` or `admin`
- password = `DEFAULT_ADMIN_PASSWORD`

After login, use the **Users** page to create the remaining accounts.

## Run as a persistent service

Copy the example service file:

```bash
sudo cp /opt/employer-system/ops/employer-system.service /etc/systemd/system/employer-system.service
```

Edit `/etc/systemd/system/employer-system.service` and confirm these values are correct:

- `User`
- `Group`
- `WorkingDirectory`
- `EnvironmentFile`

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now employer-system
```

Useful service commands:

```bash
sudo systemctl status employer-system
sudo systemctl restart employer-system
sudo journalctl -u employer-system -n 100 --no-pager
```

## Backups

Run a manual backup:

```bash
cd /opt/employer-system
./scripts/backup-db.sh
```

Default behavior:

- saves backups in `data/backups/`
- keeps the newest 10 backup files
- names files like `employer-YYYY-MM-DDTHH-MM-SS.db`

Optional overrides:

```bash
BACKUP_DIR=/srv/employer-system-backups MAX_BACKUPS=30 ./scripts/backup-db.sh
```

Suggested nightly cron job:

```bash
0 2 * * * cd /opt/employer-system && /bin/bash ./scripts/backup-db.sh >> /var/log/employer-system-backup.log 2>&1
```

## Files

- `server.js` - application entrypoint
- `package.json` - npm metadata and start command
- `.env.example` - environment template
- `ops/employer-system.service` - example `systemd` unit
- `scripts/backup.js` - SQLite-aware backup implementation
- `scripts/backup-db.sh` - backup wrapper for manual runs and cron
- `data/employer.db` - live database

## Troubleshooting

| Problem | What to check |
| --- | --- |
| App does not start | Run `npm install`, then check `journalctl -u employer-system -n 100 --no-pager` |
| `SESSION_SECRET` error | Make sure `/etc/employer-system/employer-system.env` exists and the service points to it |
| Cannot log in on first deployment | Confirm the intended `DEFAULT_ADMIN_PASSWORD` was set before the first start |
| Port conflict | Change `PORT` in the environment file and restart the service |
| Backup fails | Confirm `data/employer.db` exists and the service account can write to the backup directory |
