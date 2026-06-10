#!/usr/bin/env bash
# start-viewer.sh
# Starts the global-skills viewer in background on port 38888.
# Zero npm dependencies — no install step needed.
# Skips silently if our viewer is already running.

set -euo pipefail

PORT=38888
PID_FILE="$HOME/.claude/global-skills.pid"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$(cd "$SCRIPT_DIR/../../viewer" && pwd)"
SERVER_JS="$VIEWER_DIR/server.js"

[ -f "$SERVER_JS" ] || exit 0

# Check if port is in use by our viewer
if lsof -ti:$PORT >/dev/null 2>&1; then
    if curl -sf "http://localhost:$PORT/api/skills" >/dev/null 2>&1; then
        exit 0  # our viewer is already up
    fi
fi

# Clean up stale PID file
if [ -f "$PID_FILE" ]; then
    STALE_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
        exit 0  # process still alive
    fi
    rm -f "$PID_FILE"
fi

nohup node "$SERVER_JS" >/dev/null 2>&1 &
exit 0
