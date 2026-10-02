# sync-skills.ps1
# PostToolUse hook (Windows): hands the Claude Code event to the lesson store.
# All logic lives in viewer/store.js (`hook` command) so Windows and POSIX share
# one implementation. This script only gates on OS and locates the plugin root.
#
# Never error out — hooks must be silent on failure (exit 0 always). Problems are
# written to stderr, which Claude Code only surfaces on a non-zero exit, and
# which the runtime tests capture.

$dbg = -not [string]::IsNullOrEmpty($env:SKILL_TRACE_DEBUG)
if ($dbg) { [Console]::Error.WriteLine("skill-trace hook (ps1): start OS=$($env:OS) PS=$($PSVersionTable.PSVersion)") }

if ($env:OS -ne 'Windows_NT') { exit 0 }

$stdin = ''
try { $stdin = [Console]::In.ReadToEnd() } catch { if ($dbg) { [Console]::Error.WriteLine("skill-trace hook (ps1): stdin read failed: $($_.Exception.Message)") }; exit 0 }
if ([string]::IsNullOrWhiteSpace($stdin)) { if ($dbg) { [Console]::Error.WriteLine("skill-trace hook (ps1): empty stdin") }; exit 0 }

$root = $env:CLAUDE_PLUGIN_ROOT
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$store = Join-Path $root 'viewer\store.js'

# Locate node: explicit override, then PATH. Hooks run in whatever shell Claude
# Code inherited, which is not always the user's interactive PATH.
$node = $env:SKILL_TRACE_NODE
if ([string]::IsNullOrEmpty($node)) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { $cmd = Get-Command node -ErrorAction SilentlyContinue }
    if ($null -ne $cmd) { $node = $cmd.Source }
}
if ([string]::IsNullOrEmpty($node)) {
    [Console]::Error.WriteLine("skill-trace hook: node not found on PATH")
    exit 0
}

if ($env:SKILL_TRACE_DEBUG) {
    [Console]::Error.WriteLine("skill-trace hook (ps1): node=$node store=$store stdin=$($stdin.Length) chars")
}

try {
    $stdin | & $node $store hook | Out-Null
} catch {
    [Console]::Error.WriteLine("skill-trace hook: $($_.Exception.Message)")
}

exit 0
