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
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '..', '..');
const isWin = process.platform === 'win32';

function hookCmd() {
  return isWin
    ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'hooks', 'scripts', 'sync-skills.ps1')], 'USERPROFILE']
    : ['bash', [join(ROOT, 'hooks', 'scripts', 'sync-skills.sh')], 'HOME'];
}

function runHook(home, payload) {
  const [cmd, args, homeVar] = hookCmd();
  execFileSync(cmd, args, { input: JSON.stringify(payload), env: { ...process.env, [homeVar]: home }, stdio: ['pipe', 'pipe', 'pipe'] });
}

function runHookAsync(home, payload) {
  const [cmd, args, homeVar] = hookCmd();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, [homeVar]: home } });
    child.on('error', reject);
    child.on('close', () => resolve());
    child.stdin.end(JSON.stringify(payload));
  });
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

test('concurrent fires of the same entry append it exactly once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'st-conc-'));
  const payload = {
    tool_name: 'Write',
    tool_input: {
      file_path: join(home, 'myproj', 'docs', 'skills.md'),
      content: '## [2026-06-11] — Concurrent test\n\n**Problem:** p\n\n**Solution:** s\n',
    },
  };
  // Fire several at once to reliably hit the read-before-append window. Without a
  // lock on the global-log append, multiple writers see an empty/short file and
  // each append → duplicates. With the lock, exactly one entry survives.
  const N = 8;
  await Promise.all(Array.from({ length: N }, () => runHookAsync(home, payload)));
  const logText = readFileSync(join(home, '.claude', 'global-skills.md'), 'utf8');
  const entryCount = (logText.match(/^## \[2026/gm) || []).length;
  assert.equal(entryCount, 1, `${N} concurrent fires of the same entry must append it once, got ${entryCount}`);
});
