#!/usr/bin/env bash
# Employer Relations CRM — deploy a release, with automatic rollback.
#
#   bash deploy/deploy.sh <release-tarball>
#
# Run as a member of the ero-crm-deploy group (not as root). Build the tarball
# with deploy/make-release.sh. Steps:
#    1. take the deploy lock               7. stop the service
#    2. check free disk space              8. run the database migrations of the new release
#    3. encrypted pre-deploy backup        9. switch /opt/ero-crm/current to the new release
#    4. unpack and check the release      10. start the service
#    5. npm ci --omit=dev                 11. wait for /healthz (60 s)
#    6. record the current state          12. prune old releases, print a summary
# If anything fails after step 6, the previous release is put back, the
# database is restored from the pre-deploy backup if migrations had run, and
# the service is started again. The first installation uses the same script.
#
# Test hooks (only for the automated tests): ERO_PREFIX prefixes every path,
# ERO_SYSTEMCTL replaces "sudo -n /usr/bin/systemctl", ERO_AS_SERVICE_USER
# replaces "sudo -n -u ero-crm", ERO_NODE replaces /usr/bin/node,
# ERO_HEALTH_TIMEOUT replaces 60, and ERO_TEST_NODE_MODULES (honoured only
# with ERO_PREFIX) links that node_modules directory instead of running npm ci.

set -Eeuo pipefail

readonly SERVICE=ero-crm.service
readonly KEEP_RELEASES=5

PREFIX="${ERO_PREFIX:-}"
NODE="${ERO_NODE:-/usr/bin/node}"
NPM="${ERO_NPM:-npm}"
HEALTH_TIMEOUT="${ERO_HEALTH_TIMEOUT:-60}"
MIN_FREE_MB="${ERO_MIN_FREE_MB:-1024}"
BASE="$PREFIX/opt/ero-crm"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
ENV_FILE="$PREFIX/etc/ero-crm/ero-crm.env"
DATA_DIR="$PREFIX/var/lib/ero-crm"
BACKUP_DIR="$PREFIX/var/backups/ero-crm"
LOG_DIR="$BASE/deploy-logs"

SYSTEMCTL=()
AS_SERVICE=()
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
START_EPOCH="$(date +%s)"
LOG_FILE=""
TARBALL=""
STAGING=""
NEW_RELEASE=""
NEW_VERSION=""
PREVIOUS=""
DB_VERSION_BEFORE=""
BACKUP_FILE=""
ARMED=0       # 1 once the live system may have been changed (rollback needed on failure)
MIGRATED=0    # 1 once the database schema changed
SWITCHED=0    # 1 once current points at the new release
FAILING=0

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
step() { log "[$1/12] $2"; }

usage() {
  sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Run a command as the service user (it owns the database), with the production settings.
as_service_node() {
  "${AS_SERVICE[@]}" "$NODE" --env-file="$ENV_FILE" "$@"
}

cleanup() {
  if [[ -n "$STAGING" && -d "$STAGING" ]]; then rm -rf -- "$STAGING"; fi
  return 0
}
trap cleanup EXIT

die_early() {
  # Nothing on the live system has changed yet.
  log "DEPLOY FAILED: $*"
  if [[ -n "$NEW_RELEASE" && -d "$NEW_RELEASE" ]]; then
    rm -rf -- "$NEW_RELEASE"
    log "Removed the unpacked release $NEW_RELEASE."
  fi
  log "Nothing on the running system was changed; the current version is still running."
  [[ -n "$LOG_FILE" ]] && log "This output is saved in $LOG_FILE."
  exit 1
}

wait_healthy() {
  # The new release's helper only reads HOST and PORT, so it also checks the previous release.
  as_service_node "$NEW_RELEASE/scripts/ops/deploy-helper.js" wait-healthy "$HEALTH_TIMEOUT"
}

db_version() {
  as_service_node "$NEW_RELEASE/scripts/ops/deploy-helper.js" db-version
}

point_current_at() {
  local target="$1"
  ln -sfn -- "$target" "$BASE/.current.tmp"
  mv -T -- "$BASE/.current.tmp" "$CURRENT"
}

rollback() {
  local reason="$1" problems=()
  trap - ERR
  set +e
  log "DEPLOY FAILED: $reason"
  log "Rolling back to the previous state."

  "${SYSTEMCTL[@]}" stop "$SERVICE" || problems+=("could not stop $SERVICE")

  if ((SWITCHED)) || [[ "$(readlink -- "$CURRENT" 2>/dev/null)" != "$PREVIOUS" ]]; then
    if [[ -n "$PREVIOUS" ]]; then
      if point_current_at "$PREVIOUS"; then
        log "current points at the previous release again: $PREVIOUS"
      else
        problems+=("could not point $CURRENT back at $PREVIOUS")
      fi
    else
      rm -f -- "$CURRENT" && log "First installation: removed $CURRENT."
    fi
  fi

  if ((!MIGRATED)) && [[ -n "$DB_VERSION_BEFORE" ]]; then
    local now
    now="$(db_version 2>/dev/null)"
    [[ -n "$now" && "$now" != "$DB_VERSION_BEFORE" ]] && MIGRATED=1
  fi
  if ((MIGRATED)); then
    if [[ -n "$BACKUP_FILE" ]]; then
      log "The database was migrated (version $DB_VERSION_BEFORE before). Restoring the pre-deploy backup $BACKUP_FILE"
      local tools="$PREVIOUS"
      [[ -f "$tools/scripts/restore.js" ]] || tools="$NEW_RELEASE"
      if (cd "$tools" && as_service_node scripts/restore.js "$BACKUP_FILE" --yes --force-running); then
        log "Database restored. The migrated database was kept aside as employer.db.pre-restore-* in $DATA_DIR."
      else
        problems+=("restoring the database from $BACKUP_FILE failed")
      fi
    elif [[ -n "$PREVIOUS" ]]; then
      problems+=("the database was migrated but there is no pre-deploy backup to restore")
    fi
  fi

  if [[ -n "$PREVIOUS" ]] && ((${#problems[@]} == 0)); then
    log "Starting the previous release."
    if "${SYSTEMCTL[@]}" start "$SERVICE" && wait_healthy; then
      log "The previous release answers on /healthz again."
    else
      problems+=("the previous release did not become healthy after the rollback")
    fi
  fi

  echo
  if ((${#problems[@]} == 0)); then
    if [[ -n "$PREVIOUS" ]]; then
      log "RESULT: the deploy of $NEW_VERSION FAILED and was rolled back. The previous version is running again."
    else
      log "RESULT: the first installation FAILED. Nothing is running; fix the problem and deploy again."
    fi
  else
    log "RESULT: the deploy FAILED and the ROLLBACK ALSO FAILED. The service may be down. Problems:"
    local p
    for p in "${problems[@]}"; do log "  - $p"; done
    log "State: current -> $(readlink -- "$CURRENT" 2>/dev/null || echo 'missing'); previous release: ${PREVIOUS:-none};"
    log "       pre-deploy backup: ${BACKUP_FILE:-none}. Follow RUNBOOK.md, \"A deploy failed\"."
  fi
  log "Logs: this output is saved in $LOG_FILE; application log: journalctl -u $SERVICE -n 200 --no-pager"
  log "The failed release is left in place for inspection: $NEW_RELEASE"
  exit 1
}

fail() {
  ((FAILING)) && exit 1
  FAILING=1
  if ((ARMED)); then rollback "$*"; else die_early "$*"; fi
}

on_error() {
  fail "unexpected error (exit status $1) at deploy.sh line $2"
}

setup() {
  if (($# != 1)) || [[ "$1" == -* ]]; then
    usage
    exit 2
  fi
  TARBALL="$(readlink -f -- "$1")"
  [[ -f "$TARBALL" ]] || { echo "No such file: $1" >&2; exit 2; }
  [[ "$(id -u)" -ne 0 || -n "$PREFIX" ]] || { echo "Do not run this as root; run it as a member of ero-crm-deploy." >&2; exit 2; }
  read -r -a SYSTEMCTL <<<"${ERO_SYSTEMCTL:-sudo -n /usr/bin/systemctl}"
  read -r -a AS_SERVICE <<<"${ERO_AS_SERVICE_USER-sudo -n -u ero-crm}"
  [[ -d "$BASE" && -d "$RELEASES" ]] || { echo "$RELEASES does not exist. Run deploy/install.sh first." >&2; exit 2; }
  # The environment file is readable only by root and the service user, so check through the sudo rule.
  as_service_node -e 0 >/dev/null 2>&1 || {
    echo "Cannot run $NODE as the service user with $ENV_FILE." >&2
    echo "Check that deploy/install.sh has run and that you are in the ero-crm-deploy group (log in again after being added)." >&2
    exit 2
  }

  mkdir -p -- "$LOG_DIR"
  LOG_FILE="$LOG_DIR/deploy-$STAMP.log"
  exec > >(tee -a -- "$LOG_FILE") 2>&1
  trap 'on_error $? $LINENO' ERR
  trap 'fail "interrupted by a signal"' INT TERM
}

step_lock() {
  step 1 "Taking the deploy lock"
  exec 9>"$BASE/.deploy.lock"
  flock -n 9 || die_early "another deploy is running (lock $BASE/.deploy.lock)."
}

free_mb() {
  df -Pm -- "$1" | awk 'NR == 2 { print $4 }'
}

step_disk() {
  step 2 "Checking free disk space (at least $MIN_FREE_MB MB)"
  local dir free
  for dir in "$RELEASES" "$BACKUP_DIR"; do
    free="$(free_mb "$dir")"
    log "  $dir: $free MB free"
    ((free >= MIN_FREE_MB)) || die_early "only $free MB free on $dir. Free some space (see RUNBOOK.md, \"The disk is nearly full\")."
  done
}

step_backup() {
  step 3 "Pre-deploy backup"
  if [[ ! -L "$CURRENT" ]]; then
    log "  First installation (no $CURRENT): no backup needed."
    return 0
  fi
  if ! as_service_node -e 'process.exit(require("node:fs").existsSync(process.env.DATABASE_PATH) ? 0 : 3)'; then
    log "  No database yet: no backup needed."
    return 0
  fi
  (cd "$CURRENT" && as_service_node scripts/backup.js pre-deploy) || die_early "the pre-deploy backup failed (see above)."
  local record finished
  record="$(as_service_node -e '
    const r = JSON.parse(require("node:fs").readFileSync(require("node:path").join(process.env.BACKUP_DIR, "last-success.json"), "utf8"));
    console.log(Math.floor(Date.parse(r.finishedAt) / 1000) + " " + r.file);')" || die_early "cannot read last-success.json after the backup."
  finished="${record%% *}"
  BACKUP_FILE="${record#* }"
  [[ "$finished" -ge "$START_EPOCH" && "$BACKUP_FILE" == *pre-deploy.db.enc ]] ||
    die_early "the backup record does not describe this deploy's backup ($BACKUP_FILE)."
  log "  Backup: $BACKUP_FILE"
}

step_unpack() {
  step 4 "Unpacking $TARBALL"
  STAGING="$(mktemp -d "$RELEASES/.incoming-XXXXXX")"
  tar -xzf "$TARBALL" -C "$STAGING" || die_early "cannot unpack $TARBALL."
  local root="$STAGING"
  if [[ ! -f "$root/package.json" ]]; then
    local entries=("$STAGING"/*)
    ((${#entries[@]} == 1)) && [[ -f "${entries[0]}/package.json" ]] && root="${entries[0]}"
  fi
  [[ -f "$root/package.json" && -f "$root/src/server.js" ]] || die_early "the tarball has no package.json and src/server.js: not a release."
  NEW_VERSION="$("$NODE" -p 'require(process.argv[1]).version' "$root/package.json")" || die_early "cannot read the version."
  [[ "$NEW_VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] || die_early "unexpected version \"$NEW_VERSION\" in package.json."
  NEW_RELEASE="$RELEASES/$NEW_VERSION-$STAMP"
  mv -T -- "$root" "$NEW_RELEASE"
  log "  Release $NEW_VERSION unpacked to $NEW_RELEASE"
  "$NODE" "$NEW_RELEASE/scripts/ops/deploy-helper.js" engines "$NEW_RELEASE/package.json" ||
    die_early "this release needs a different Node.js version (see above)."
}

step_dependencies() {
  step 5 "Installing dependencies"
  if [[ -n "$PREFIX" && -n "${ERO_TEST_NODE_MODULES:-}" ]]; then
    ln -s -- "$ERO_TEST_NODE_MODULES" "$NEW_RELEASE/node_modules"
    log "  Test mode: linked $ERO_TEST_NODE_MODULES"
    return 0
  fi
  (cd "$NEW_RELEASE" && "$NPM" ci --omit=dev --no-audit --no-fund) || die_early "npm ci failed (see above)."
}

step_record() {
  step 6 "Recording the current state"
  if [[ -L "$CURRENT" ]]; then PREVIOUS="$(readlink -f -- "$CURRENT")"; fi
  DB_VERSION_BEFORE="$(db_version)" || die_early "cannot read the database's migration version."
  log "  Current release: ${PREVIOUS:-none (first installation)}"
  log "  Database migration version: $DB_VERSION_BEFORE"
  ARMED=1
}

step_stop() {
  step 7 "Stopping $SERVICE"
  "${SYSTEMCTL[@]}" stop "$SERVICE" || fail "could not stop $SERVICE."
}

step_migrate() {
  step 8 "Running database migrations of the new release"
  local status=0 after
  (cd "$NEW_RELEASE" && as_service_node scripts/migrate.js) || status=$?
  after="$(db_version)" || after=""
  if [[ "$after" != "$DB_VERSION_BEFORE" ]]; then MIGRATED=1; fi
  ((status == 0)) || fail "the database migration failed (see above)."
  log "  Database migration version: $DB_VERSION_BEFORE -> $after"
}

step_switch() {
  step 9 "Switching $CURRENT to $NEW_RELEASE"
  point_current_at "$NEW_RELEASE" || fail "could not switch $CURRENT."
  SWITCHED=1
}

step_start() {
  step 10 "Starting $SERVICE"
  "${SYSTEMCTL[@]}" start "$SERVICE" || fail "could not start $SERVICE."
}

step_health() {
  step 11 "Waiting up to $HEALTH_TIMEOUT s for /healthz"
  wait_healthy || fail "the new release did not answer /healthz within $HEALTH_TIMEOUT s."
}

step_prune() {
  step 12 "Pruning old releases (keeping $KEEP_RELEASES)"
  local releases=() release index=0
  mapfile -t releases < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
  for release in "${releases[@]}"; do
    index=$((index + 1))
    ((index > KEEP_RELEASES)) || continue
    [[ "$release" == "$NEW_RELEASE" || "$release" == "$PREVIOUS" ]] && continue
    rm -rf -- "$release" && log "  Removed $release"
  done
  local seconds=$(($(date +%s) - START_EPOCH))
  echo
  log "DEPLOY SUCCEEDED in $seconds s."
  log "  Version:            $NEW_VERSION"
  log "  Running release:    $NEW_RELEASE"
  log "  Previous release:   ${PREVIOUS:-none}"
  log "  Database version:   $DB_VERSION_BEFORE -> $(db_version)"
  log "  Pre-deploy backup:  ${BACKUP_FILE:-none (first installation)}"
  log "  Log of this deploy: $LOG_FILE"
}

main() {
  setup "$@"
  log "Deploying $TARBALL"
  step_lock
  step_disk
  step_backup
  step_unpack
  step_dependencies
  step_record
  step_stop
  step_migrate
  step_switch
  step_start
  step_health
  ARMED=0
  step_prune
}

main "$@"
