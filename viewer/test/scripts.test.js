'use strict';

// Cross-platform syntax validation of the sync hooks. Each OS validates its own
// script; the CI matrix (ubuntu + windows + macos) covers all three. This is the
// regression guard for the dead-on-PS-5.1 parse bug that shipped undetected.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

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

  test('sync-skills.sh embedded python compiles', () => {
    const src = readFileSync(SH, 'utf8');
    const m = src.match(/<< 'PYEOF'\n([\s\S]*?)\nPYEOF/);
    assert.ok(m, 'python heredoc found');
    const py = join(mkdtempSync(join(tmpdir(), 'st-py-')), 'h.py');
    writeFileSync(py, m[1], 'utf8');
    execFileSync('python3', ['-m', 'py_compile', py], { stdio: 'pipe' });
  });
}
