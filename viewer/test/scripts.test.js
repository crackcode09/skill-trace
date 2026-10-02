'use strict';

// Cross-platform syntax validation of the sync hook wrappers. Each OS validates
// its own script; the CI matrix (ubuntu + windows + macos) covers all three. The
// wrappers are now one-call shims around `node store.js hook`, but the PS 5.1
// parse guard stays: a dead-on-PowerShell script once shipped undetected.

const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const PS1 = join(ROOT, 'hooks', 'scripts', 'sync-skills.ps1');
const SH  = join(ROOT, 'hooks', 'scripts', 'sync-skills.sh');

if (process.platform === 'win32') {
  test('sync-skills.ps1 parses clean on Windows PowerShell 5.1', () => {
    const ps = `$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(PS1)},[ref]$null,[ref]$e)|Out-Null;if($e){$e|%{Write-Output $_.Message};exit 1}`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe' });
  });
} else {
  test('sync-skills.sh passes bash -n', () => {
    execFileSync('bash', ['-n', SH], { stdio: 'pipe' });
  });
}
