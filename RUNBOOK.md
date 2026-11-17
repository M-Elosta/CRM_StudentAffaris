# Runbook: Employer Relations CRM

What to do when something goes wrong. Each section: how you notice, first checks, the fix, and how to confirm. All
commands are for the real server **(server)** unless said otherwise. Background: [DEPLOYMENT.md](DEPLOYMENT.md),
[RESTORE.md](RESTORE.md).

Most checks below use this shortcut, which runs a script as the service user with the production settings:

```sh
cd /opt/ero-crm/current
RUN="sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm/ero-crm.env"
$RUN scripts/ops/monitor.js          # every check, one line each; exit status 1 if any fails
```

Alerts: when a backup, integrity check or the daily monitor run fails, systemd starts `ero-crm-alert@<unit>.service`,
which writes the alert to the journal and runs `ALERT_COMMAND` if one is configured. Alerts contain no personal data.
List recent alerts with `sudo journalctl -u 'ero-crm-alert@*' --since -7d --no-pager`.

## The site is down

**Notice:** users report errors or timeouts; IT monitoring of `/healthz` fails; `monitor.js` shows `FAIL health`.

**First checks:**

```sh
systemctl status ero-crm.service --no-pager
curl -fsS http://127.0.0.1:3000/healthz                 # the application itself, bypassing nginx
sudo journalctl -u ero-crm.service -n 100 --no-pager
systemctl status nginx --no-pager && sudo nginx -t
df -h /var/lib/ero-crm /var/backups/ero-crm
```

**Fix:**

- Application stopped or failed: read the last log lines. Common causes: a missing setting in `/etc/ero-crm/ero-crm.env`
  (the message names it), a full disk, or "the application is older than the database" after someone restored a release
  by hand. Fix the cause, then `sudo systemctl restart ero-crm.service`. After 5 failed starts in 10 minutes systemd
  stops trying; `sudo systemctl reset-failed ero-crm.service` before starting again.
- `curl` to 127.0.0.1:3000 works but the site does not: nginx. Check `sudo nginx -t`, the certificate, and on RHEL
  SELinux (`sudo setsebool -P httpd_can_network_connect 1`).
- Right after a deploy: see "A deploy failed".

**Confirm:** `curl -fsS http://127.0.0.1:3000/healthz` prints `{"status":"ok"}` and the site loads in a browser.

## A deploy failed

**Notice:** `deploy.sh` ends with `DEPLOY FAILED`. Its output is saved in `/opt/ero-crm/deploy-logs/deploy-<time>.log`.

**First checks:** read the last 30 lines of that log. It ends with one of three results:

1. `Nothing on the running system was changed` (failure before the service was stopped: disk, backup, tarball,
   `npm ci`). The old version still runs. Fix the cause shown above that line and deploy again.
2. `...was rolled back. The previous version is running again.` The service was stopped, `current` points at the
   previous release again and, if migrations had run, the database was restored from the pre-deploy backup (the
   migrated database is kept as `/var/lib/ero-crm/employer.db.pre-restore-<time>`). Users may have lost nothing: the
   service was stopped during the whole attempt. Send the log and `sudo journalctl -u ero-crm.service --since -1h` to
   the developers. The failed release stays in `/opt/ero-crm/releases/` for inspection.
3. `the ROLLBACK ALSO FAILED`. The log lists what failed and the state: where `current` points, the previous release
   and the pre-deploy backup.

**Fix for case 3:**

```sh
sudo systemctl stop ero-crm.service
ls -l /opt/ero-crm/current /opt/ero-crm/releases/
# point current at the previous release named in the log
ln -sfn /opt/ero-crm/releases/<previous> /opt/ero-crm/.current.tmp && mv -T /opt/ero-crm/.current.tmp /opt/ero-crm/current
# only if the log says the database was migrated: restore the pre-deploy backup named in the log
cd /opt/ero-crm/current
$RUN scripts/restore.js /var/backups/ero-crm/employer-<time>-pre-deploy.db.enc
sudo systemctl start ero-crm.service
```

**Confirm:** `curl -fsS http://127.0.0.1:3000/healthz`; `readlink /opt/ero-crm/current` is the previous release.

## A backup failed or is stale

**Notice:** an alert for `ero-crm-backup.service`; `monitor.js` shows `FAIL backup-age` (no success for 26 hours) or
`FAIL offsite-copy`.

**First checks:**

```sh
systemctl status ero-crm-backup.service ero-crm-backup.timer --no-pager
sudo journalctl -u ero-crm-backup.service -n 50 --no-pager
sudo cat /var/backups/ero-crm/last-success.json
df -h /var/backups/ero-crm
```

**Fix**, by the message in the log:

- `off-server backup directory ... is not available`: the share is not mounted (`findmnt /mnt/ero-crm-backups`). Mount
  it. The local backup was made and verified; the next run also copies the files that were missed.
- `off-server copy command failed`: run the command by hand as `ero-crm` with a test file; check credentials and the
  network path to the backup host.
- `BACKUP_KEY_FILE is not set` or `Cannot read the backup key file`: check the setting and that
  `/etc/ero-crm/backup.key` is mode 0640, owner root, group ero-crm.
- `Another backup is running`: wait; if no backup runs (`pgrep -af backup.js`), the next run takes over the stale lock.
- `Skipped ... not an intact SQLite database`: a plain `employer-*.db` file in the backup directory is damaged. Move it
  out of the directory and tell the developers; the backup itself continues.
- Disk full: see "The disk is nearly full".

Then run the backup again: `sudo systemctl start ero-crm-backup.service`.

The application writes its own pre-migration backup unencrypted when it changes the database structure at start-up.
Every backup run encrypts such files and deletes the plain copies, so an unencrypted `employer-*.db` file in
`/var/backups/ero-crm/` for more than a day means backups are not running.

**Confirm:** `sudo cat /var/backups/ero-crm/last-success.json` shows a `finishedAt` from the last minutes and
`"mode": "dir"` or `"command"` under `remote`; `monitor.js` shows `OK backup-age`.

## The disk is nearly full

**Notice:** `monitor.js` shows `FAIL disk-data` or `FAIL disk-backups` (under 1024 MB free); a deploy stops at step 2.

**First checks:**

```sh
df -h / /var/lib/ero-crm /var/backups/ero-crm /opt/ero-crm
sudo du -sh /var/lib/ero-crm/* /var/backups/ero-crm /opt/ero-crm/releases/* /var/log/nginx/ero-crm 2>/dev/null
sudo journalctl --disk-usage
```

**Fix:**

- Old `employer.db.pre-restore-*` files in `/var/lib/ero-crm/` (left by restores and rollbacks): delete them once you
  are sure they are not needed.
- Too many backups: lower `BACKUP_KEEP_DAILY`/`WEEKLY`/`MONTHLY` in the environment file; the next backup applies it.
  Never delete the newest backups by hand.
- Journal: `sudo journalctl --vacuum-size=500M`, and cap it permanently in `/etc/systemd/journald.conf`
  (`SystemMaxUse=500M`).
- Old releases: `deploy.sh` keeps 5; older ones can be removed by hand, never the one `current` points at.
- Otherwise ask IT to grow the volume.

**Confirm:** `monitor.js` shows `OK` for both disk checks.

## The certificate is about to expire

**Notice:** `monitor.js` shows `FAIL tls-certificate` (21 days or less left; needs `MONITOR_TLS_CERT_FILE` set);
browsers warn.

**First checks:**
`sudo openssl x509 -in /etc/ssl/<path>/ero-crm.fullchain.pem -noout -enddate -subject` and the certificate that is
actually served: `echo | openssl s_client -connect <name>:443 -servername <name> 2>/dev/null | openssl x509 -noout -enddate`.

**Fix:** IT renews the certificate (their process; see IT_REQUIREMENTS.md), replaces the files named in the nginx site,
then `sudo nginx -t && sudo systemctl reload nginx`.

**Confirm:** the `s_client` command shows the new end date; `monitor.js` shows `OK tls-certificate`.

## The integrity check failed

**Notice:** an alert for `ero-crm-integrity.service`; `monitor.js` shows `FAIL integrity`.

**First checks:**

```sh
sudo journalctl -u ero-crm-integrity.service -n 20 --no-pager
sudo cat /var/backups/ero-crm/last-integrity.json
sudo systemctl start ero-crm-integrity.service     # run it again
```

**Fix:**

- Only `foreign_key_check` violations: the data is readable but some rows point at records that no longer exist. Tell
  the developers; do not restore. The site keeps working.
- `integrity_check` reports errors (database corruption): act quickly, before more data is written on top.
  1. Take a backup now, if it still works: `sudo systemctl start ero-crm-backup.service`. Keep it; it may hold recent
     data.
  2. Stop the service: `sudo systemctl stop ero-crm.service`.
  3. Check the disk and the kernel log for I/O errors: `sudo dmesg | grep -i error | tail`.
  4. Restore the newest backup that passes its check (RESTORE.md, section 5). The restore checks every backup before it
     uses it; if the newest fails, try the next older one.
  5. Tell users which period of data entry to check and re-enter.

**Confirm:** `sudo systemctl start ero-crm-integrity.service` succeeds and `last-integrity.json` shows `"ok": true`.

## Data was deleted by mistake

**Notice:** a user reports missing records.

**First:** the application's Trash. Once soft delete is available, deleted records are kept there for 90 days and can be
restored by an administrator without affecting anything else. (Check the application version: at the time of writing,
PROGRESS.md lists soft delete and restore as not yet built, so deletes are permanent.)

**Last resort, a backup.** A full restore replaces the whole database and loses everything entered since the backup.
Prefer recovering only the lost records:

1. Find the newest backup from before the deletion (RESTORE.md, section 3).
2. Restore it to a separate path, which touches nothing else:
   `$RUN scripts/restore.js /var/backups/ero-crm/<file>.db.enc --to /var/lib/ero-crm/recovery/employer.db --yes`
3. Give that copy to the developers to re-insert the lost records into the live database, or look the records up in it
   and re-enter them by hand.
4. Delete the recovery copy afterwards: `sudo rm -r /var/lib/ero-crm/recovery`.

Only if a large part of the data is gone and nothing important was entered since the backup: do a full restore
(RESTORE.md, section 5).

**Confirm:** the records are visible in the application again.

## A user is locked out

**Notice:** a user cannot sign in.

**First checks:** the exact message they see, and `sudo journalctl -u ero-crm.service --since -1h --no-pager | grep -i login`.

**Fix:**

- "Too many sign-in attempts": the application allows 10 attempts per 15 minutes from one address
  (`LOGIN_RATE_LIMIT_PER_15_MIN`), and nginx allows 10 a minute. Wait 15 minutes. Restarting the service
  (`sudo systemctl restart ero-crm.service`) also clears the application's counter, and signs nobody out.
- Account deactivated: an administrator reactivates it under **Admin → Users**.
- Forgotten password: there is no self-service reset yet, and an administrator cannot set another user's password in
  this version. Ask the developers; until a reset feature exists, an administrator can remove the account and create it
  again with a temporary password, and ask the user to change it on the **Account** page at first sign-in.
- The only administrator is locked out: ask the developers. Do not edit the database by hand.

**Confirm:** the user signs in.

## A secret leaked

Act on the one that leaked. After any change, check the site and the next backup.

### Session secret (`SESSION_SECRET`)

**Invalidates:** nothing stored; changing it signs everyone out.

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # new value
sudoedit /etc/ero-crm/ero-crm.env                                                  # replace SESSION_SECRET
sudo systemctl restart ero-crm.service
```

**Confirm:** `/healthz` answers; users sign in again.

### Backup key (`/etc/ero-crm/backup.key`)

**Invalidates:** nothing immediately, but whoever has the key and a copy of the backups can read them. A new key does
not protect backups that were already copied; it protects future ones. Old backups need the old key to be restored.

1. Keep the old key with the old backups: `sudo mv /etc/ero-crm/backup.key /etc/ero-crm/backup.key.old-$(date +%F)`
   and store it in the vault, labelled with the date range of the backups it opens.
2. Create a new key and set its owner and mode:

   ```sh
   cd /opt/ero-crm/current
   sudo /usr/bin/node scripts/ops/generate-backup-key.js /etc/ero-crm/backup.key
   sudo chown root:ero-crm /etc/ero-crm/backup.key && sudo chmod 0640 /etc/ero-crm/backup.key
   ```

3. Store a second copy of the new key in the vault. Take a backup and drill it (RESTORE.md, section 4).
4. Decide with the data owner whether old backups on the off-server location must be deleted earlier than usual.

To restore an old backup later: `$RUN scripts/restore.js <file> --key-file /etc/ero-crm/backup.key.old-<date> --to ...`
(the key file must be readable by `ero-crm`).

### Administrator password

**Invalidates:** only that account's password; existing sessions of that account should be ended too.

The administrator signs in and changes the password on the **Account** page. If an attacker may already have signed
in, also rotate `SESSION_SECRET` (above) to end every session, and check **Admin → Users** for accounts you do not
recognise. If `BOOTSTRAP_ADMIN_PASSWORD` is still in the environment file, remove it: it is only used while no users
exist, but it should not stay on disk.

**Confirm:** the old password no longer works; the new one does.
