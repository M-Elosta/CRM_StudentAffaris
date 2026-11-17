# What to request from IT

A checklist for the request to CMU-Q IT for the Employer Relations CRM server. Each item has the reason in one line.
Sizes assume fewer than 20 users and a database under 1 GB.

## Server

- [ ] **One Linux VM: Ubuntu Server 24.04 LTS (or 22.04), or RHEL 9 / Rocky / AlmaLinux 9.** Supported by the install
      script; long-term security updates.
- [ ] **2 vCPU, 4 GB RAM.** Node.js and SQLite need little; the headroom covers reports, imports and OS updates.
- [ ] **Disk: 40 GB for the OS and application, plus a separate 40 GB volume (or at least 40 GB free) for
      `/var/lib/ero-crm` and `/var/backups/ero-crm`.** A 1 GB database with 7 daily, 4 weekly and 12 monthly backups and
      30 days of pre-deploy backups needs up to about 30 GB; monitoring warns below 1 GB free.
- [ ] **Local disk (not NFS or SMB) for `/var/lib/ero-crm`.** SQLite locking is not reliable on network file systems.
- [ ] **VM snapshots or image backups, if IT has them.** A second, independent safety net; not a replacement for the
      application's own backups.

## Software and patching

- [ ] **Node.js 22 LTS (22.12 or later) installed system-wide at `/usr/bin/node`, from NodeSource or the distribution's
      `nodejs:22` module.** The systemd units run that path; 22 is the supported runtime until April 2027.
- [ ] **Who applies Node.js security updates (minor versions of 22) and when.** Node.js publishes security releases
      several times a year.
- [ ] **nginx from the distribution.** Terminates HTTPS in front of the application.
- [ ] **Who owns OS patching and reboots, and the maintenance window.** The application restarts by itself after a
      reboot; tell the office before planned downtime.
- [ ] **Time synchronisation on (chrony or systemd-timesyncd).** Backup names, retention and session expiry depend on
      the clock.

## Network and names

- [ ] **A DNS name, for example `ero-crm.qatar.cmu.edu`.** Users and the TLS certificate need a stable name.
- [ ] **A TLS certificate for that name, and who renews it and how.** Monitoring alerts 21 days before expiry; the
      renewal itself is IT's process.
- [ ] **Inbound: TCP 443 (and 80, which only redirects to 443) from the campus network/VPN; SSH for administrators.**
      The application itself listens only on 127.0.0.1.
- [ ] **Outbound to the off-server backup destination.** Backups that stay on the server do not survive losing it.
- [ ] **Outbound to the npm registry (registry.npmjs.org) at deploy time, or an internal npm mirror.** `deploy.sh` runs
      `npm ci`. If neither is allowed, the developers must ship tarballs that include `node_modules` built for this OS.
- [ ] **Later: outbound to the identity provider (CMU Shibboleth or Microsoft Entra ID) for single sign-on.** Planned;
      not needed for the first release.

## Backups and alerts

- [ ] **An off-server backup location: an SMB/NFS share mounted on the server (for example `/mnt/ero-crm-backups`) or
      an SSH/SFTP account on a backup host.** The nightly job copies each encrypted backup there and verifies it.
- [ ] **Retention on that location: at least 12 months.** Matches the application's monthly retention; the files are
      encrypted, about the size of the database each.
- [ ] **A place for a second copy of the backup encryption key (IT password vault).** Without the key no backup can
      be restored by anyone.
- [ ] **Who receives alerts, and how: an e-mail address and a working local mailer (`mail`), or a command of IT's
      monitoring system.** Failed backups, integrity checks and daily monitoring failures run `ALERT_COMMAND`.
- [ ] **Optional: IT monitoring that runs `scripts/ops/monitor.js --json` or checks `https://<name>/healthz`.** Faster
      detection than the daily check.

## Access

- [ ] **A sudo rule for the deploy group (installed by `deploy/install.sh` in `/etc/sudoers.d/ero-crm-deploy`):
      members of `ero-crm-deploy` may run `systemctl start|stop|restart|status ero-crm.service` as root and
      `/usr/bin/node` as the `ero-crm` user.** Deploys and rollbacks without giving developers root; the second rule
      lets `deploy.sh` run the backup, migration and restore scripts as the database owner.
- [ ] **Accounts on the server for the people who deploy, added to `ero-crm-deploy`.** Deploys run as named people,
      not a shared account.
- [ ] **Root for one run of `deploy/install.sh` at installation.** Creates the user, directories, units and secrets.
