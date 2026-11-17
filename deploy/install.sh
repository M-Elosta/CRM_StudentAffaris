#!/usr/bin/env bash
# Employer Relations CRM — one-time server preparation. Run as root:
#
#   sudo bash deploy/install.sh [--dry-run]
#
# Prepares the server for deploy/deploy.sh: service user and groups,
# directories, systemd units and timers, logrotate and nginx files, the
# environment file with fresh secrets, the backup key and a sudoers rule for
# the deploy group. It does not start the application (there is no release
# yet) and it never overwrites an existing file. Running it again changes
# nothing that is already in place.
#
# For testing without root, every path is prefixed by ERO_PREFIX and the
# service manager is ERO_SYSTEMCTL (default: systemctl).

set -euo pipefail

readonly SERVICE_USER=ero-crm
readonly DEPLOY_GROUP=ero-crm-deploy
readonly MIN_NODE_MAJOR=22
readonly MIN_NODE_MINOR=12

PREFIX="${ERO_PREFIX:-}"
NODE="${ERO_NODE:-/usr/bin/node}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
CHANGES=0
OS_FAMILY=""
IS_ROOT=0
NEW_ADMIN_PASSWORD=""
NEW_KEY=0
SYSTEMCTL=()
TMP_FILES=()

log() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
changed() {
  CHANGES=$((CHANGES + 1))
  if ((DRY_RUN)); then log "  [dry run] would: $*"; else log "  $*"; fi
}
unchanged() { log "  unchanged: $*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local file
  for file in "${TMP_FILES[@]+"${TMP_FILES[@]}"}"; do
    rm -f -- "$file"
  done
}
trap cleanup EXIT

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

parse_args() {
  while (($#)); do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "Unknown option: $1 (use --help)" ;;
    esac
    shift
  done
  read -r -a SYSTEMCTL <<<"${ERO_SYSTEMCTL:-systemctl}"
}

check_privileges() {
  if [[ -n "$PREFIX" ]]; then
    # A test install into a directory never creates system users or changes owners, even as root.
    log "ERO_PREFIX=$PREFIX: user and group creation and ownership changes are skipped."
  elif [[ "$(id -u)" -eq 0 ]]; then
    IS_ROOT=1
  else
    die "Run this as root: sudo bash deploy/install.sh"
  fi
}

detect_os() {
  step "Operating system"
  local release="$PREFIX/etc/os-release"
  [[ -r "$release" ]] || release=/etc/os-release
  [[ -r "$release" ]] || die "Cannot read /etc/os-release to tell which Linux distribution this is."
  local id id_like
  id="$(sed -n 's/^ID=//p' "$release" | tr -d '"')"
  id_like="$(sed -n 's/^ID_LIKE=//p' "$release" | tr -d '"')"
  case " $id $id_like " in
    *" debian "* | *" ubuntu "*) OS_FAMILY=debian ;;
    *" rhel "* | *" fedora "* | *" centos "*) OS_FAMILY=rhel ;;
    *) die "Unsupported distribution \"$id\". Supported: Ubuntu/Debian and the RHEL family (RHEL, Rocky, AlmaLinux)." ;;
  esac
  log "  $id ($OS_FAMILY family), from $release"
}

node_install_help() {
  log ""
  log "Install Node.js 22 LTS (22.12 or later) from NodeSource, then run this script again:"
  if [[ "$OS_FAMILY" == debian ]]; then
    log "  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh"
    log "  sudo bash /tmp/nodesource_setup.sh"
    log "  sudo apt-get install -y nodejs"
  else
    log "  sudo dnf module list nodejs            # RHEL 9.4+/8.10+ ship a nodejs:22 stream"
    log "  sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs"
    log "  or from NodeSource:"
    log "  curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh"
    log "  sudo bash /tmp/nodesource_setup.sh && sudo dnf install -y nodejs"
  fi
  log "The systemd units run $NODE, so Node.js must be installed system-wide at that path (not with nvm)."
}

check_node() {
  step "Node.js"
  if [[ ! -x "$NODE" ]]; then
    log "  $NODE was not found."
    node_install_help
    exit 1
  fi
  local version major minor
  version="$("$NODE" --version)"
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  if ((major < MIN_NODE_MAJOR || (major == MIN_NODE_MAJOR && minor < MIN_NODE_MINOR))); then
    log "  Node.js $version is too old."
    node_install_help
    exit 1
  fi
  log "  Node.js $version at $NODE"
}

ensure_group() {
  local group="$1"
  if getent group "$group" >/dev/null; then
    unchanged "group $group exists"
  elif ((!IS_ROOT)); then
    log "  skipped (test prefix or not root): create group $group"
  else
    changed "create system group $group"
    ((DRY_RUN)) || groupadd --system "$group"
  fi
}

ensure_user() {
  local nologin=/usr/sbin/nologin
  [[ -x "$nologin" ]] || nologin=/sbin/nologin
  if getent passwd "$SERVICE_USER" >/dev/null; then
    unchanged "user $SERVICE_USER exists"
  elif ((!IS_ROOT)); then
    log "  skipped (test prefix or not root): create user $SERVICE_USER"
  else
    changed "create system user $SERVICE_USER (no login shell, home /var/lib/ero-crm)"
    ((DRY_RUN)) || useradd --system --gid "$SERVICE_USER" --home-dir /var/lib/ero-crm --no-create-home \
      --shell "$nologin" --comment "Employer Relations CRM" "$SERVICE_USER"
  fi
}

# ensure_dir <path> <mode> <owner> <group>
ensure_dir() {
  local dir="$PREFIX$1" mode="$2" owner="$3" group="$4"
  if [[ ! -d "$dir" ]]; then
    changed "create directory $dir (mode $mode, $owner:$group)"
    if ((!DRY_RUN)); then
      mkdir -p -- "$dir"
      chmod "$mode" -- "$dir"
      ((IS_ROOT)) && chown "$owner:$group" -- "$dir"
    fi
    return 0
  fi
  local current_mode
  current_mode="$(stat -c '%a' -- "$dir")"
  if [[ "$current_mode" != "${mode#0}" ]]; then
    changed "set mode of $dir from $current_mode to $mode"
    ((DRY_RUN)) || chmod "$mode" -- "$dir"
  fi
  if ((IS_ROOT)) && [[ "$(stat -c '%U:%G' -- "$dir")" != "$owner:$group" ]]; then
    changed "set owner of $dir to $owner:$group"
    ((DRY_RUN)) || chown "$owner:$group" -- "$dir"
  fi
  if [[ "$current_mode" == "${mode#0}" ]]; then unchanged "directory $dir"; fi
}

# install_file <source> <destination> <mode> [owner] [group]: never overwrites.
install_file() {
  local src="$1" dest="$PREFIX$2" mode="$3" owner="${4:-root}" group="${5:-root}"
  if [[ -e "$dest" ]]; then
    if cmp -s -- "$src" "$dest"; then
      unchanged "$dest"
    else
      log "  kept existing $dest (it differs from the shipped copy; compare with: diff $src $dest)"
    fi
    return 0
  fi
  changed "install $dest (mode $mode)"
  if ((!DRY_RUN)); then
    mkdir -p -- "$(dirname -- "$dest")"
    install -m "$mode" -- "$src" "$dest"
    ((IS_ROOT)) && chown "$owner:$group" -- "$dest"
  fi
  return 0
}

create_users() {
  step "Users and groups"
  ensure_group "$SERVICE_USER"
  ensure_user
  ensure_group "$DEPLOY_GROUP"
  log "  Add each person who deploys to $DEPLOY_GROUP: sudo usermod -aG $DEPLOY_GROUP <username> (then log in again)."
}

create_directories() {
  step "Directories"
  ensure_dir /opt/ero-crm 2775 root "$DEPLOY_GROUP"
  ensure_dir /opt/ero-crm/releases 2775 root "$DEPLOY_GROUP"
  ensure_dir /var/lib/ero-crm 0750 "$SERVICE_USER" "$SERVICE_USER"
  ensure_dir /var/backups/ero-crm 0750 "$SERVICE_USER" "$SERVICE_USER"
  ensure_dir /etc/ero-crm 0750 root "$SERVICE_USER"
  ensure_dir /var/log/nginx/ero-crm 0755 root root
}

install_units() {
  step "systemd units, logrotate and nginx site"
  local unit units_changed=$CHANGES
  for unit in "$SRC_DIR"/deploy/systemd/*; do
    install_file "$unit" "/etc/systemd/system/$(basename -- "$unit")" 0644
  done
  UNITS_CHANGED=$((CHANGES - units_changed))
  install_file "$SRC_DIR/deploy/logrotate/ero-crm" /etc/logrotate.d/ero-crm 0644

  # The shipped site file contains CHANGE_ME placeholders, so it is installed
  # where nginx does not load it yet. DEPLOYMENT.md says how to enable it.
  if [[ "$OS_FAMILY" == debian ]]; then
    NGINX_SITE=/etc/nginx/sites-available/ero-crm.conf
  else
    NGINX_SITE=/etc/nginx/conf.d/ero-crm.conf.disabled
  fi
  if [[ -d "$PREFIX/etc/nginx" ]]; then
    install_file "$SRC_DIR/deploy/nginx/ero-crm.conf" "$NGINX_SITE" 0644
  else
    log "  nginx is not installed ($PREFIX/etc/nginx is missing): site file not installed. Install nginx and run this again."
  fi
}

random_token() {
  "$NODE" -e "process.stdout.write(require('node:crypto').randomBytes(Number(process.argv[1])).toString('base64url'))" "$1"
}

create_env_file() {
  step "Environment file"
  local dest="$PREFIX/etc/ero-crm/ero-crm.env"
  if [[ -e "$dest" ]]; then
    unchanged "$dest (existing file kept; no secrets generated)"
    return 0
  fi
  changed "create $dest (mode 0640, root:$SERVICE_USER) with a new SESSION_SECRET and a one-time admin password"
  ((DRY_RUN)) && return 0
  local tmp secret password
  tmp="$(mktemp "$PREFIX/etc/ero-crm/.ero-crm.env.XXXXXX")"
  TMP_FILES+=("$tmp")
  secret="$(random_token 48)"
  password="$(random_token 18)"
  sed -e "s|@SESSION_SECRET@|$secret|" -e "s|@BOOTSTRAP_ADMIN_PASSWORD@|$password|" \
    "$SRC_DIR/deploy/ero-crm.env.template" >"$tmp"
  if [[ -n "$PREFIX" ]]; then
    # Test installs: point the data paths into the prefix as well.
    sed -i -e "s|=/var/lib/ero-crm|=$PREFIX/var/lib/ero-crm|" -e "s|=/var/backups/ero-crm|=$PREFIX/var/backups/ero-crm|" \
      -e "s|=/etc/ero-crm/|=$PREFIX/etc/ero-crm/|" "$tmp"
  fi
  chmod 0640 -- "$tmp"
  ((IS_ROOT)) && chown "root:$SERVICE_USER" -- "$tmp"
  mv -- "$tmp" "$dest"
  NEW_ADMIN_PASSWORD="$password"
}

create_backup_key() {
  step "Backup encryption key"
  local key="$PREFIX/etc/ero-crm/backup.key"
  if [[ -e "$key" ]]; then
    unchanged "$key (existing key kept)"
    return 0
  fi
  changed "create $key (mode 0640, root:$SERVICE_USER)"
  ((DRY_RUN)) && return 0
  "$NODE" "$SRC_DIR/scripts/ops/generate-backup-key.js" "$key" >/dev/null
  chmod 0640 -- "$key"
  ((IS_ROOT)) && chown "root:$SERVICE_USER" -- "$key"
  NEW_KEY=1
}

install_sudoers() {
  step "sudo rule for the $DEPLOY_GROUP group"
  local dest="$PREFIX/etc/sudoers.d/ero-crm-deploy"
  if [[ -e "$dest" ]]; then
    unchanged "$dest"
    return 0
  fi
  changed "install $dest (mode 0440)"
  ((DRY_RUN)) && return 0
  local tmp
  tmp="$(mktemp)"
  TMP_FILES+=("$tmp")
  cat >"$tmp" <<EOF
# Employer Relations CRM: what members of $DEPLOY_GROUP may do with sudo.
# Installed by deploy/install.sh. Check with: sudo visudo -cf $dest
#
# Start, stop, restart and inspect the application service, nothing else.
Cmnd_Alias ERO_CRM_SERVICE = /usr/bin/systemctl start ero-crm.service, \\
                             /usr/bin/systemctl stop ero-crm.service, \\
                             /usr/bin/systemctl restart ero-crm.service, \\
                             /usr/bin/systemctl status ero-crm.service
%$DEPLOY_GROUP ALL=(root) NOPASSWD: ERO_CRM_SERVICE
# deploy/deploy.sh runs the backup, migration and restore scripts of a release
# as the service user, which owns the database. Deployers install the code that
# runs as $SERVICE_USER anyway, so this grants no further access.
%$DEPLOY_GROUP ALL=($SERVICE_USER) NOPASSWD: /usr/bin/node
EOF
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "$tmp" >/dev/null || die "visudo rejected the generated sudoers file; nothing was installed."
    log "  checked with visudo -cf"
  else
    log "  visudo not found: the sudoers file was not syntax-checked"
  fi
  mkdir -p -- "$(dirname -- "$dest")"
  install -m 0440 -- "$tmp" "$dest"
  ((IS_ROOT)) && chown root:root -- "$dest"
  return 0
}

enable_units() {
  step "systemd"
  if ((UNITS_CHANGED > 0)); then
    changed "${SYSTEMCTL[*]} daemon-reload"
    ((DRY_RUN)) || "${SYSTEMCTL[@]}" daemon-reload
  else
    unchanged "unit files (no daemon-reload needed)"
  fi
  local unit
  for unit in ero-crm.service ero-crm-backup.timer ero-crm-integrity.timer ero-crm-monitor.timer; do
    if ((!DRY_RUN)) && "${SYSTEMCTL[@]}" is-enabled --quiet "$unit" 2>/dev/null; then
      unchanged "$unit is enabled"
      continue
    fi
    if [[ "$unit" == *.timer ]]; then
      changed "enable and start $unit"
      ((DRY_RUN)) || "${SYSTEMCTL[@]}" enable --now "$unit"
    else
      # Enabled so it starts at boot; not started now, as there is no release yet.
      changed "enable $unit (not started)"
      ((DRY_RUN)) || "${SYSTEMCTL[@]}" enable "$unit"
    fi
  done
}

summary() {
  step "Summary"
  if ((CHANGES == 0)); then
    log "Nothing to change: this server is already prepared."
  elif ((DRY_RUN)); then
    log "Dry run: $CHANGES change(s) listed above; nothing was changed."
    return 0
  else
    log "$CHANGES change(s) made."
  fi
  if ((NEW_KEY)); then
    cat <<EOF

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! A new backup encryption key was created: $PREFIX/etc/ero-crm/backup.key
!! Store a second copy NOW somewhere other than this server (IT password vault
!! or a sealed envelope in a safe). If this key is lost, every backup is
!! permanently unreadable. See RESTORE.md, section 7.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
EOF
  fi
  if [[ -n "$NEW_ADMIN_PASSWORD" ]]; then
    cat <<EOF

One-time password for the first administrator (user "admin"). It is shown only
now; it is also in $PREFIX/etc/ero-crm/ero-crm.env until you remove it:

    $NEW_ADMIN_PASSWORD

Sign in, change it, then delete the BOOTSTRAP_ADMIN_PASSWORD line from the file.
EOF
  fi
  cat <<EOF

Next steps:
  1. Edit $PREFIX/etc/ero-crm/ero-crm.env: set BASE_URL and an off-server backup
     destination (BACKUP_REMOTE_DIR or BACKUP_REMOTE_COMMAND).
  2. Edit the nginx site ($PREFIX$NGINX_SITE): replace every CHANGE_ME, enable it
     (see DEPLOYMENT.md), then: sudo nginx -t && sudo systemctl reload nginx
  3. Add the people who deploy to the $DEPLOY_GROUP group.
  4. As one of them, deploy the first release:
       bash deploy/deploy.sh ero-crm-<version>.tar.gz
EOF
}

main() {
  parse_args "$@"
  check_privileges
  ((DRY_RUN)) && log "Dry run: nothing will be changed."
  detect_os
  check_node
  create_users
  create_directories
  install_units
  create_env_file
  create_backup_key
  install_sudoers
  enable_units
  summary
}

UNITS_CHANGED=0
NGINX_SITE=""
main "$@"
