# Deploying the Employer Relations CRM

From an empty Linux VM to a running site, then updates, rollback and a staging instance. For what to request from IT
first, see [IT_REQUIREMENTS.md](IT_REQUIREMENTS.md). For day-to-day problems, see [RUNBOOK.md](RUNBOOK.md); for
restores, [RESTORE.md](RESTORE.md).

Commands marked **(server)** need a real server (root, systemd, nginx) and were not run while writing this guide. The
install and deploy scripts themselves were run end to end in a test directory (`ERO_PREFIX`) with a stand-in service
manager; that is what the automated tests in `tests/ops/` do.

## How it fits together

| Piece            | Where                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Application code | `/opt/ero-crm/releases/<version>-<time>/`; `/opt/ero-crm/current` → active                                  |
| Database         | `/var/lib/ero-crm/employer.db` (SQLite, local disk only, never NFS/SMB)                                     |
| Local backups    | `/var/backups/ero-crm/` (encrypted `.db.enc` files)                                                         |
| Configuration    | `/etc/ero-crm/ero-crm.env` (0640 root:ero-crm)                                                              |
| Backup key       | `/etc/ero-crm/backup.key` (0640 root:ero-crm); keep a second copy elsewhere                                 |
| Application      | `ero-crm.service`, user `ero-crm`, listens on `127.0.0.1:3000`                                              |
| Scheduled jobs   | `ero-crm-backup.timer` (01:30 nightly), `ero-crm-integrity.timer` (Friday), `ero-crm-monitor.timer` (07:40) |
| Alerts           | `ero-crm-alert@<unit>.service`, journal plus optional `ALERT_COMMAND`                                       |
| Web server       | nginx on 443 (TLS), proxies to `127.0.0.1:3000`                                                             |
| Application logs | journald: `journalctl -u ero-crm.service`                                                                   |
| Deploy logs      | `/opt/ero-crm/deploy-logs/`                                                                                 |

People who deploy are members of the `ero-crm-deploy` group. They do not need root: a sudo rule lets them start, stop,
restart and inspect `ero-crm.service`, and run Node.js as `ero-crm` (the backup, migration and restore scripts must run
as the user that owns the database).

## Ubuntu and RHEL-family differences

| Step               | Ubuntu / Debian                                                                      | RHEL / Rocky / AlmaLinux                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Install Node.js 22 | NodeSource `setup_22.x`, then `apt-get install nodejs`                               | `dnf module enable nodejs:22` or NodeSource, then `dnf install nodejs`                   |
| Install nginx      | `sudo apt-get install nginx`                                                         | `sudo dnf install nginx && sudo systemctl enable --now nginx`                            |
| nginx site file    | `/etc/nginx/sites-available/ero-crm.conf`, enable with a symlink in `sites-enabled/` | `/etc/nginx/conf.d/ero-crm.conf.disabled`, rename to `.conf`                             |
| SELinux            | not used                                                                             | `sudo setsebool -P httpd_can_network_connect 1`                                          |
| Firewall           | `sudo ufw allow 80,443/tcp`                                                          | `sudo firewall-cmd --permanent --add-service={http,https} && sudo firewall-cmd --reload` |
| `nologin` shell    | `/usr/sbin/nologin`                                                                  | `/sbin/nologin` (both exist on current releases)                                         |

`deploy/install.sh` detects the family from `/etc/os-release` and chooses the right paths.

## 1. Prepare the server (once, as root)

1. Install Node.js 22.12 or later system-wide (`/usr/bin/node`), nginx, and make sure time sync (chrony or
   systemd-timesyncd) is on. `install.sh` prints the exact Node.js commands for your distribution if it is missing.
2. As the person who will deploy, copy a release tarball to your home directory on the server (see "Building a
   release" below) and unpack it there: `tar -xzf ero-crm-0.9.0-<commit>.tar.gz`.
3. Preview, then run the installer **(server)**:

   ```sh
   cd ~/ero-crm-0.9.0-<commit>
   sudo bash deploy/install.sh --dry-run
   sudo bash deploy/install.sh
   ```

   It creates the user, groups, directories, systemd units and timers, the logrotate file, the nginx site file, the
   environment file with a new `SESSION_SECRET`, the backup key and the sudo rule. It enables the timers and enables (but
   does not start) the application. It never overwrites an existing file; running it again changes nothing and says so.

   At the end it prints two things once:
   - **a reminder to store a second copy of `/etc/ero-crm/backup.key`** away from the server (IT password vault). Do it
     now. Without the key no backup can be restored;
   - **the one-time administrator password**. Note it for the first sign-in.

4. Edit `/etc/ero-crm/ero-crm.env` **(server)**: set `BASE_URL`, and an off-server backup destination
   (`BACKUP_REMOTE_DIR` for a mounted share, or `BACKUP_REMOTE_COMMAND`). If you use a mounted share, also allow the
   backup job to write there: `sudo systemctl edit ero-crm-backup.service` and add

   ```ini
   [Service]
   ReadWritePaths=/mnt/ero-crm-backups
   ```

5. Configure nginx **(server)**: replace every `CHANGE_ME` in the site file (server name, certificate and key paths), then

   ```sh
   # Ubuntu
   sudo ln -s /etc/nginx/sites-available/ero-crm.conf /etc/nginx/sites-enabled/ero-crm.conf
   # RHEL family
   sudo mv /etc/nginx/conf.d/ero-crm.conf.disabled /etc/nginx/conf.d/ero-crm.conf
   sudo setsebool -P httpd_can_network_connect 1
   # both
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. Add each person who deploys to the deploy group, then they log out and in again **(server)**:
   `sudo usermod -aG ero-crm-deploy <username>`.

## 2. First deployment

As a member of `ero-crm-deploy` (not root) **(server)**:

```sh
bash ~/ero-crm-0.9.0-<commit>/deploy/deploy.sh ~/ero-crm-0.9.0-<commit>.tar.gz
```

The first deployment uses the same script as every update. With no `current` release it skips the pre-deploy backup,
creates the database through the migrations, starts the service and waits for `/healthz`.

Then sign in at `https://<your server>/` as `admin` with the one-time password, change it, delete the
`BOOTSTRAP_ADMIN_PASSWORD` line from `/etc/ero-crm/ero-crm.env` and run `sudo systemctl restart ero-crm.service`.

Finally take a first backup and check everything **(server)**:

```sh
sudo systemctl start ero-crm-backup.service
sudo journalctl -u ero-crm-backup.service -n 20 --no-pager
cd /opt/ero-crm/current
sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm/ero-crm.env scripts/ops/monitor.js
```

## 3. Building a release

On a machine with the git repository:

```sh
bash deploy/make-release.sh v1.0.0 ./dist       # or a branch or commit; default HEAD
```

This writes `dist/ero-crm-<version>-<commit>.tar.gz` and a `.sha256` file. Only committed files are included. Check
the checksum on the server with `sha256sum -c ero-crm-<version>-<commit>.tar.gz.sha256`.

`deploy.sh` runs `npm ci --omit=dev` on the server, which needs access to the npm registry (or a proxy/mirror). If the
server has no such access, see IT_REQUIREMENTS.md.

## 4. Updating

```sh
bash /opt/ero-crm/current/deploy/deploy.sh /path/to/ero-crm-<version>-<commit>.tar.gz      # (server)
```

Each step is printed with a time and saved in `/opt/ero-crm/deploy-logs/`:

1. Takes a lock so two deploys cannot overlap.
2. Checks there is at least 1 GB free for releases and backups.
3. Makes an encrypted `pre-deploy` backup with the current release (and copies it off the server).
4. Unpacks the tarball into `/opt/ero-crm/releases/<version>-<time>/` and checks `engines.node` in `package.json`.
5. Runs `npm ci --omit=dev` there.
6. Records which release is current and the database's migration version.
7. Stops the service.
8. Runs the new release's migrations (`scripts/migrate.js`, which also prints row counts before and after).
9. Switches `/opt/ero-crm/current` to the new release in one atomic step.
10. Starts the service.
11. Waits up to 60 seconds for `http://127.0.0.1:3000/healthz` to answer 200.
12. Deletes all but the 5 newest releases (never the current or the previous one) and prints a summary.

Users see an interruption of a few seconds between steps 7 and 11.

## 5. How rollback works

If anything fails from step 7 on, `deploy.sh`:

1. stops the service;
2. points `current` back at the previous release;
3. if the database was migrated, restores the pre-deploy backup with
   `scripts/restore.js --yes --force-running` (the migrated database is kept aside as `employer.db.pre-restore-<time>`,
   never deleted);
4. starts the previous release and waits for `/healthz`;
5. exits with an error that says the deploy failed, that the previous version runs again, and where the logs are.

If the rollback itself fails, it says exactly that, lists what failed, and prints where `current` points, which release
was running before and which backup to restore. Follow RUNBOOK.md, "A deploy failed".

A failure before step 7 (no space, backup failed, bad tarball, `npm ci` failed) changes nothing on the running system;
the unpacked release is removed.

Rolling back by hand to an older release that needs no database change is the same as deploying it again: keep the
tarballs. A release cannot run on a database that a newer release has migrated; the application refuses to start and
says so. In that case restore the matching pre-deploy backup (RESTORE.md).

## 6. A staging instance

Run staging on a separate VM if you can. On the same VM, keep it completely separate:

| Setting    | Production                     | Staging                                |
| ---------- | ------------------------------ | -------------------------------------- |
| `NODE_ENV` | `production`                   | `staging`                              |
| Port       | 3000                           | for example 3100                       |
| Database   | `/var/lib/ero-crm/employer.db` | `/var/lib/ero-crm-staging/employer.db` |
| Backups    | `/var/backups/ero-crm`         | `/var/backups/ero-crm-staging`         |
| Key        | `/etc/ero-crm/backup.key`      | its own key                            |
| Host name  | the production name            | its own name and certificate           |

Staging is filled only with fictional demonstration data, never with a copy of production data:

```sh
cd /opt/ero-crm-staging/current
sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm-staging/ero-crm.env scripts/seed-demo.js --staging   # (server)
```

(`npm run seed:demo -- --staging` does the same from a shell that has the staging settings.) The seed script refuses
staging without `--staging`, always refuses production, and refuses a database that already holds employers unless
`--reset` is given.

The scripts take their paths from `ERO_PREFIX`, so on a separate staging VM `install.sh` and `deploy.sh` work unchanged.
On a shared VM the shipped units and paths are production's; a second instance needs copies of the units under another
name, its own environment file and directories. Ask the developers before setting that up.
