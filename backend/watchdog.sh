#!/usr/bin/env bash
# Self-healing watchdog: keeps `npm run spam` alive. If the engine process is
# gone (and no stop sentinel exists), it restarts it. Stop cleanly by creating
# the file  state/STOP  (touch state/STOP) — the watchdog and engine both exit.
set -u
cd "$(dirname "$0")"
LOG=watchdog.log
STOP=state/STOP
echo "[$(date -u +%FT%TZ)] watchdog started" >> "$LOG"
while true; do
  if [ -f "$STOP" ]; then
    echo "[$(date -u +%FT%TZ)] STOP sentinel found — killing engine and exiting" >> "$LOG"
    pkill -9 -f "index.ts --spam" 2>/dev/null
    exit 0
  fi
  if ! pgrep -f "index.ts --spam" >/dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] engine not running — restarting" >> "$LOG"
    nohup npm run spam >> spam-engine.log 2>&1 &
    sleep 5
  fi
  sleep 20
done
