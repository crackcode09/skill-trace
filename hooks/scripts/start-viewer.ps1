# start-viewer.ps1
# Starts the global-skills viewer in background on port 38888.
# Runs npm install on first use. Skips silently if port already occupied.
param()

$ErrorActionPreference = 'SilentlyContinue'

$port = 38888

# Skip if port already in use
$inUse = netstat -ano 2>$null | Select-String ":$port\s"
if ($inUse) { exit 0 }

$script_dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer_dir = [System.IO.Path]::GetFullPath((Join-Path $script_dir "..\..\viewer"))
$server     = Join-Path $viewer_dir "server.js"
$node_mods  = Join-Path $viewer_dir "node_modules"
$pkg        = Join-Path $viewer_dir "package.json"

if (-not (Test-Path $server)) { exit 0 }

# One-time npm install if node_modules missing
if ((Test-Path $pkg) -and (-not (Test-Path $node_mods))) {
    try {
        Push-Location $viewer_dir
        npm install --ignore-scripts --silent 2>$null
    } finally {
        Pop-Location
    }

    # Copy compiled better-sqlite3 binary from RMA project (Node 22 prebuilt workaround)
    $rmaBindings = "$env:USERPROFILE\OneDrive - PBC Linear\Documents\nidhin.dev\PBC_quality\rma_process_automate\node_modules\better-sqlite3\build\Release\better_sqlite3.node"
    $dstBindings = Join-Path $node_mods "better-sqlite3\build\Release\better_sqlite3.node"
    if ((Test-Path $rmaBindings) -and (Test-Path (Split-Path $dstBindings))) {
        Copy-Item $rmaBindings $dstBindings -Force 2>$null
    }
}

Start-Process "node" -ArgumentList "`"$server`"" -WindowStyle Hidden -WorkingDirectory $viewer_dir
exit 0
