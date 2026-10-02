# sync-skills.ps1
# PostToolUse hook (Windows): hands the Claude Code event to the lesson store.
# All logic lives in viewer/store.js (`hook` command) so Windows and POSIX share
# one implementation. This script only gates on OS and locates the plugin root.
#
# Never error out — hooks must be silent on failure (exit 0 always). Anything
# node writes to stderr is left alone: Claude Code only surfaces hook stderr on
# a non-zero exit, and tests want to see it.

if ($env:OS -ne 'Windows_NT') { exit 0 }

$stdin = ''
try { $stdin = [Console]::In.ReadToEnd() } catch { exit 0 }
if ([string]::IsNullOrWhiteSpace($stdin)) { exit 0 }

$root = $env:CLAUDE_PLUGIN_ROOT
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$store = Join-Path $root 'viewer\store.js'

try {
    $stdin | node $store hook | Out-Null
} catch {
    # node missing or not on PATH: nothing to do, stay silent
}

exit 0
