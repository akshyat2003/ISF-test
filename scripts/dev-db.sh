#!/usr/bin/env bash
# Local PostgreSQL for development and tests, without Docker.
# Usage: scripts/dev-db.sh start|stop|status   (prints the connection URL on start)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${PGDATA_DIR:-$ROOT/.pgdata}"
PORT="${PGPORT:-54329}"
BIN="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | sort -V | tail -1)")"
run() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"; [ "$(id -u)" = 0 ] && chown postgres "$DATA"
      run "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! run "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      run "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -h 127.0.0.1 -k /tmp" -l "$DATA/server.log" -w start >/dev/null
    fi
    psql "postgres://postgres@127.0.0.1:$PORT/postgres" -tAc "select 1 from pg_database where datname='jathara'" | grep -q 1 \
      || psql "postgres://postgres@127.0.0.1:$PORT/postgres" -qc "create database jathara"
    echo "postgres://postgres@127.0.0.1:$PORT/jathara"
    ;;
  stop) run "$BIN/pg_ctl" -D "$DATA" -m fast stop ;;
  status) run "$BIN/pg_ctl" -D "$DATA" status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 1 ;;
esac
