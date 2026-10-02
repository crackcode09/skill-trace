# sync-skills.ps1
# PostToolUse hook (Windows): hands the Claude Code event to the lesson store.
# All logic lives in viewer/store.js (`hook` command) so Windows and POSIX share
# one implementation. This script only gates on OS and locates the plugin root.
#
# Never error out — hooks must be silent on failure.

if ($env:OS -ne 'Windows_NT') { exit 0 }

$stdin = ''
try { $stdin = [Console]::In.ReadToEnd() } catch { exit 0 }
if ([string]::IsNullOrWhiteSpace($stdin)) { exit 0 }

$root = $env:CLAUDE_PLUGIN_ROOT
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$store = Join-Path $root 'viewer\store.js'

try {
    $node = Get-Command node -ErrorAction Stop
    $stdin | & $node.Source $store hook 2>$null | Out-Null
} catch { }

exit 0
