'use strict';

// RUNTIME test of the sync hook — spawns the real per-OS script with a temp
// home dir and asserts the full chain: payload -> source recorded (trusted=no) ->
// entry parsed -> appended to global log with provenance + schema marker.
//
// This is the coverage that parse-only checks miss. The PS 5.1 dead-code bug and
// the missing-mkdir parity gap both passed a parser but failed at runtime; only
// executing the script catches that class.
//
// NOTE: single-fire only. The global-log append path is not yet lock-guarded, so a
// concurrent double-fire can still duplicate the entry (the registry IS guarded).
// Locking the log path + a concurrent-dup assertion is the next hardening step.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..', '..');
const isWin = process.platform === 'win32';

function runHook(home, payload) {
  const json = JSON.stringify(payload);
  if (isWin) {
    const ps1 = join(ROOT, 'hooks', 'scripts', 'sync-skills.ps1');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { input: json, env: { ...process.env, USERPROFILE: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    const sh = join(ROOT, 'hooks', 'scripts', 'sync-skills.sh');
    execFileSync('bash', [sh],
      { input: json, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

test('hook records source trusted=no and appends entry with provenance + marker', () => {
  const home = mkdtempSync(join(tmpdir(), 'st-hook-'));
  const skills = join(home, 'myproj', 'docs', 'skills.md');
  runHook(home, {
    tool_name: 'Write',
    tool_input: {
      file_path: skills,
      content: '## [2026-06-11] — Runtime chain test\n\n**Problem:** p\n\n**Solution:** s\n\n**Takeaway:** t\n',
    },
  });

  const reg = join(home, '.claude', 'skill-trace-trust.txt');
  const log = join(home, '.claude', 'global-skills.md');
  assert.ok(existsSync(reg), 'trust registry created');
  assert.ok(existsSync(log), 'global log created');

  const regRows = readFileSync(reg, 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'));
  assert.equal(regRows.length, 1, 'exactly one source row');
  assert.match(regRows[0], /^myproj \| no \| \d{4}-\d{2}-\d{2} \|\s*\|\s*$/, 'spec-exact row, trusted=no, grant fields empty');

  const logText = readFileSync(log, 'utf8');
  assert.match(logText, /skill-trace-schema: 1/, 'schema marker written on bootstrap');
  assert.match(logText, /Runtime chain test <!-- myproj -->/, 'entry tagged with the derived slug');
  const entryCount = (logText.match(/^## \[2026/gm) || []).length;
  assert.equal(entryCount, 1, 'single fire => single entry');
});
