#!/usr/bin/env bash
# sync-skills.sh
# PostToolUse hook (macOS/Linux): hands the Claude Code event to the lesson store.
# All logic lives in viewer/store.js (`hook` command) so Windows and POSIX share
# one implementation. This script only gates on OS and locates the plugin root.
#
# Never error out — hooks must be silent on failure.

# Gate: Windows (Git Bash / MSYS / Cygwin) is handled by sync-skills.ps1.
# Exiting here prevents both scripts firing for one event.
case "$OSTYPE" in
  msys*|cygwin*|win32*) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
node "$ROOT/viewer/store.js" hook 2>/dev/null >/dev/null
exit 0
