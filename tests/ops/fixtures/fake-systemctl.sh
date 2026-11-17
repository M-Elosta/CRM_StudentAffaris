#!/usr/bin/env bash
# Stand-in for systemctl in the ops tests (ERO_SYSTEMCTL). Everything happens
# under ERO_PREFIX. "start ero-crm.service" really starts
#   node --env-file=$ERO_PREFIX/etc/ero-crm/ero-crm.env $ERO_PREFIX/opt/ero-crm/current/src/server.js
# in the background, like systemd with Type=simple; "stop" stops it.
set -euo pipefail

: "${ERO_PREFIX:?ERO_PREFIX must be set}"
NODE="${ERO_NODE:-node}"
STATE="$ERO_PREFIX/run/fake-systemd"
mkdir -p "$STATE"
printf '%s\n' "$*" >>"$STATE/calls.log"

pid_file="$STATE/ero-crm.pid"

app_running() {
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

start_app() {
  if app_running; then return 0; fi
  [[ -e "$ERO_PREFIX/opt/ero-crm/current/src/server.js" ]] || return 0 # ConditionPathExists
  (
    exec 9>&- # do not hold the deploy lock: systemd would not pass it on either
    cd "$ERO_PREFIX/opt/ero-crm/current"
    exec "$NODE" --env-file="$ERO_PREFIX/etc/ero-crm/ero-crm.env" src/server.js >>"$STATE/app.log" 2>&1 </dev/null
  ) &
  echo $! >"$pid_file"
}

stop_app() {
  if ! app_running; then
    rm -f "$pid_file"
    return 0
  fi
  local pid i
  pid="$(cat "$pid_file")"
  kill -TERM "$pid" 2>/dev/null || true
  for ((i = 0; i < 200; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

command="${1:-}"
shift || true
case "$command" in
  start | stop | restart | status)
    [[ "${1:-}" == ero-crm.service ]] || {
      echo "fake systemctl: only ero-crm.service is handled" >&2
      exit 1
    }
    case "$command" in
      start) start_app ;;
      stop) stop_app ;;
      restart)
        stop_app
        start_app
        ;;
      status) app_running ;;
    esac
    ;;
  daemon-reload) ;;
  enable)
    for unit in "$@"; do [[ "$unit" == --* ]] || touch "$STATE/enabled.$unit"; done
    ;;
  is-enabled)
    for unit in "$@"; do [[ "$unit" == --* ]] || [[ -e "$STATE/enabled.$unit" ]] || exit 1; done
    ;;
  *)
    echo "fake systemctl: unsupported command $command" >&2
    exit 1
    ;;
esac
