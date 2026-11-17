# Restoring the Employer Relations CRM database

This guide is for an IT administrator who has not worked with this system before. It covers where the backups are, how
to restore one, how to practise a restore without touching the live system, and what to do about the backup key.

Commands marked **(server)** need the real server and were not run while writing this guide. Every other command was
run end to end in a test directory with the same scripts.

## 1. What you need to know first

- The whole database is one SQLite file: `/var/lib/ero-crm/employer.db`. While the application runs, two more files may
  sit beside it: `employer.db-wal` and `employer.db-shm`. They are part of the database.
- Backups are made every night at about 01:30 Qatar time by `ero-crm-backup.timer`, and before every deployment. Each
  backup is one encrypted file named like `employer-2026-11-17T22-30-04Z-nightly.db.enc`. The time in the name is UTC.
  The label at the end says why it was made: `nightly`, `manual`, `pre-deploy`, or `pre-migration-0004`.
- Every backup is encrypted with the key in `/etc/ero-crm/backup.key`. **Without that exact key a backup cannot be
  restored by anyone.** See section 7.
- The application also makes its own backup before it changes the database structure at start-up. That copy is written
  unencrypted (`employer-...-pre-migration-NNNN.db`); the next backup run encrypts it and deletes the plain file.

## 2. Where the backups are

| Location                                           | What is there                                         |
| -------------------------------------------------- | ----------------------------------------------------- |
| `/var/backups/ero-crm/` on the application server  | Recent backups (see retention below)                  |
| `BACKUP_REMOTE_DIR` or wherever IT's command sends | The off-server copy. Survives the loss of the server. |
| `/var/backups/ero-crm/last-success.json`           | Name, size, SHA-256 and row counts of the last backup |

The off-server destination is set in `/etc/ero-crm/ero-crm.env` (`BACKUP_REMOTE_DIR` or `BACKUP_REMOTE_COMMAND`).

Retention, applied after each backup (local directory and `BACKUP_REMOTE_DIR`): the newest backup of each of the last 7
days that have a backup, of each of the last 4 weeks, and of each of the last 12 months; the most recent backup is always
kept; `pre-deploy` and `pre-migration` backups are also kept for 30 days.

## 3. Listing backups

**(server)**

```sh
sudo ls -lt /var/backups/ero-crm/            # newest first
sudo cat /var/backups/ero-crm/last-success.json
```

All later commands use this shortcut, which runs a script as the service user with the production settings:

```sh
cd /opt/ero-crm/current
RUN="sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm/ero-crm.env"
```

## 4. Practise a restore (a drill) without touching production

Do this at least once a quarter, and after any change to the backup key or the off-server destination. It proves that
the backups can be decrypted and are complete. The live database and the service are not touched.

**(server)**

```sh
cd /opt/ero-crm/current
RUN="sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm/ero-crm.env"
BACKUP=$(sudo ls -t /var/backups/ero-crm/employer-*.db.enc | head -n 1)
$RUN scripts/restore.js "$BACKUP" --to /var/lib/ero-crm/drill/employer.db --yes
```

The script prints `Integrity: ok`, the migration version and the number of rows in every table. Compare the row counts
with `tableCounts` in `last-success.json`; for the newest backup they are identical. Then delete the drill copy, which
contains personal data:

```sh
sudo rm -r /var/lib/ero-crm/drill
```

Also drill the off-server copy at least twice a year: copy one file back from the off-server location to the server and
restore it with `--to` as above. That is the copy you need if the server is lost.

A drill on another machine (for example a new server after a disaster) works the same way: install the release, put the
key file in place (mode 0640 or stricter, never readable by everyone), and pass it with
`BACKUP_KEY_FILE=/path/to/backup.key node scripts/restore.js <file> --to <path> --yes`.

## 5. Full restore of the live database

Use this only when the data in the application cannot be fixed another way. If someone deleted records by mistake,
first look in the application's **Trash**: deleted records can be restored there without losing anything entered since.

1. Decide which backup to restore (section 3). Everything entered after that backup was taken is lost, so prefer the
   newest backup made before the problem started.
2. Tell users the system is unavailable, then stop the service **(server)**:

   ```sh
   sudo systemctl stop ero-crm.service
   ```

3. Restore **(server)**:

   ```sh
   cd /opt/ero-crm/current
   RUN="sudo -u ero-crm /usr/bin/node --env-file=/etc/ero-crm/ero-crm.env"
   $RUN scripts/restore.js /var/backups/ero-crm/employer-2026-11-17T22-30-04Z-nightly.db.enc
   ```

   The script:
   - decrypts the backup to a temporary file beside the database and checks it (`integrity_check`,
     `foreign_key_check`); if anything is wrong it stops and changes nothing;
   - prints the row counts and the migration version;
   - refuses to continue if the application still answers on `http://127.0.0.1:3000/healthz` (stop the service first);
   - asks you to type `restore`;
   - moves the current database and its `-wal`/`-shm` files aside as `employer.db.pre-restore-<time>` (they are never
     deleted), and puts the restored file in place with the same owner and mode.

4. Start the service and check it **(server)**:

   ```sh
   sudo systemctl start ero-crm.service
   curl -fsS http://127.0.0.1:3000/healthz          # {"status":"ok"}
   sudo journalctl -u ero-crm.service -n 50 --no-pager
   ```

   If the backup is older than the installed release, the application applies the newer database migrations at start-up.
   That is normal and is shown in the log.

5. Sign in and check the most recent records you expect to see.
6. Take a fresh backup so the restored state is protected **(server)**:
   `sudo systemctl start ero-crm-backup.service`.
7. Keep the `employer.db.pre-restore-*` files until you are sure the restore is right, then delete them (they hold
   personal data).

Options of `scripts/restore.js`:

| Option              | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `--to <path>`       | Restore to that path instead of the live database and touch nothing else (drills). |
| `--yes`             | Do not ask for confirmation (for scripts; the deploy rollback uses it).            |
| `--force-running`   | Restore even though the application answers. Only for the automatic rollback.      |
| `--key-file <path>` | Decrypt with this key file instead of `BACKUP_KEY_FILE`.                           |

## 6. Checking the result

- The restore prints `Integrity: ok`. The weekly integrity check can also be run at once **(server)**:
  `sudo systemctl start ero-crm-integrity.service && sudo journalctl -u ero-crm-integrity.service -n 5 --no-pager`.
- `$RUN scripts/ops/monitor.js` reports health, disk space, backup age, the off-server copy and the integrity result.

## 7. The backup key

- The key is `/etc/ero-crm/backup.key` (owner root, group ero-crm, mode 0640). It was created at installation.
- **If the key is lost, every backup made with it is permanently unreadable.** Nobody, including the developers, can
  recover the data. The encryption is AES-256-GCM.
- So keep a second copy of the key somewhere other than the application server, and not next to the off-server backups:
  for example in IT's password vault, or on paper in a safe. Check once a year that the copy is still there and still
  matches (`sudo sha256sum /etc/ero-crm/backup.key` on the server; compare with the copy).
- Never replace the key file on a running system. A new key makes all older backups unreadable unless the old key is
  also kept. If the key must be changed (for example because it leaked; see RUNBOOK.md), keep the old key with the old
  backups for as long as they are retained.
- A wrong key is reported clearly (`encrypted with a different key`). A changed or damaged backup file is reported as
  `failed authentication`; nothing is restored from it. Try the next older backup.

## 8. How often to drill

| When                                         | What                                               |
| -------------------------------------------- | -------------------------------------------------- |
| Every quarter                                | Drill with the newest local backup (section 4)     |
| Twice a year                                 | Drill with a file fetched from the off-server copy |
| After changing the key or backup destination | Drill at once                                      |
| Once a year                                  | Check the second copy of the key                   |
