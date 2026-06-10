# start-viewer.ps1
# Starts the global-skills viewer in background on port 38888.
# Zero npm dependencies — no install step needed.
# Skips silently if our viewer is already running.
param()

$ErrorActionPreference = 'SilentlyContinue'

$port    = 38888
$pidFile = Join-Path $env:USERPROFILE '.claude\global-skills.pid'

# If port in use, probe to see if it's already our viewer
$inUse = netstat -ano 2>$null | Select-String ":$port\s"
if ($inUse) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/skills" -UseBasicParsing -TimeoutSec 2 2>$null
        if ($resp.StatusCode -eq 200) { exit 0 }  # our viewer is already up
    } catch {}
}

# Clean up stale PID files from crashed previous sessions
if (Test-Path $pidFile) {
    $stalePid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($stalePid) {
        $proc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
        if (-not $proc) { Remove-Item $pidFile -Force 2>$null }
        else { exit 0 }  # process still alive — skip
    }
}

$script_dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer_dir = [System.IO.Path]::GetFullPath((Join-Path $script_dir "..\..\viewer"))
$server     = Join-Path $viewer_dir "server.js"

if (-not (Test-Path $server)) { exit 0 }

Start-Process "node" -ArgumentList "`"$server`"" -WindowStyle Hidden -WorkingDirectory $viewer_dir
exit 0
