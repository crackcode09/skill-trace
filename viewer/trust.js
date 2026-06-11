'use strict';

// skill-trace trust CLI — the ONLY automated way to flip a source's trust flag.
//
//   node trust.js                 list the registry
//   node trust.js grant  <slug>   flip no -> yes (granted-by=command)
//   node trust.js revoke <slug>   flip yes -> no
//
// Invariants (see docs/TRUST.md): this tool acts ONLY on the slug a human passes
// on the command line. It never reads the skills log, never infers trust from
// file content, and the sync hook never calls it. Registry is the seam Phase 2
// injection reads — only `yes` rows inject.

const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync,
        openSync, closeSync, unlinkSync, statSync } = require('fs');
const { join, dirname } = require('path');
const { homedir } = require('os');

const TRUST_PATH = process.env.SKILL_TRACE_TRUST_PATH ||
  join(homedir(), '.claude', 'skill-trace-trust.txt');

const HEADER = [
  '# skill-trace source trust registry',
  '# columns: project-slug | trusted(yes|no) | first-seen | granted-at | granted-by',
  "# The sync hook only ever ADDS rows as 'no'. Granting trust (no -> yes) is done",
  '# ONLY by you: the /skill-trust command or editing this file. Phase 2 injection',
  "# uses 'yes' rows only. Trust is never decided from synced file content.",
].join('\n');

const COLS = ['slug', 'trusted', 'firstSeen', 'grantedAt', 'grantedBy'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Returns { comments: string[], rows: object[] }
function parseRegistry() {
  if (!existsSync(TRUST_PATH)) return { comments: [], rows: [] };
  const comments = [];
  const rows = [];
  for (const line of readFileSync(TRUST_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('#')) { comments.push(line.replace(/\s+$/, '')); continue; }
    const parts = t.split('|').map(p => p.trim());
    const row = {};
    COLS.forEach((c, i) => { row[c] = parts[i] || ''; });
    if (row.slug) rows.push(row);
  }
  return { comments, rows };
}

function serialize(rows) {
  const body = rows
    .map(r => `${r.slug} | ${r.trusted || 'no'} | ${r.firstSeen || ''} | ${r.grantedAt || ''} | ${r.grantedBy || ''}`)
    .join('\n');
  return HEADER + '\n' + body + (body ? '\n' : '');
}

// Atomic write: temp-then-rename so a partial write can't leave a torn file.
function writeRegistry(rows) {
  const dir = dirname(TRUST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = TRUST_PATH + '.tmp';
  writeFileSync(tmp, serialize(rows), 'utf8');
  renameSync(tmp, TRUST_PATH);
}

// Same lock the sync hooks use, so a CLI rewrite can't clobber a concurrent
// hook append (and vice versa). Bounded retry; steal a stale lock; best-effort.
function withLock(fn) {
  const lock = TRUST_PATH + '.lock';
  const dir = dirname(TRUST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let acquired = false;
  for (let i = 0; i < 50; i++) {
    try {
      closeSync(openSync(lock, 'wx'));
      acquired = true;
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 15000) { unlinkSync(lock); continue; }
      } catch { /* lock vanished — retry */ }
      const until = Date.now() + 30;
      while (Date.now() < until) { /* brief spin; CLI is short-lived */ }
    }
  }
  try { return fn(); }
  finally { if (acquired) { try { unlinkSync(lock); } catch { /* already gone */ } } }
}

function list() {
  const { rows } = parseRegistry();
  if (!rows.length) {
    console.log('No sources recorded yet. Sync a project, then grant it trust.');
    return;
  }
  const w = Math.max(...rows.map(r => r.slug.length), 12);
  console.log('TRUSTED  SOURCE'.padEnd(9) + ''.padEnd(w) + '  GRANTED-BY');
  for (const r of rows) {
    const mark = r.trusted === 'yes' ? '  yes  ' : '  no   ';
    console.log(`${mark}  ${r.slug.padEnd(w)}  ${r.grantedBy || ''}`);
  }
}

function setTrust(slug, value, grantedBy) {
  if (!slug) {
    console.error('Usage: node trust.js ' + (value === 'yes' ? 'grant' : 'revoke') + ' <project-slug>');
    process.exit(2);
  }
  withLock(() => {
    const { rows } = parseRegistry();
    const row = rows.find(r => r.slug === slug);
    if (!row) {
      console.error(`Source "${slug}" is not in the registry. It is recorded automatically the first time it syncs. Known sources:`);
      rows.forEach(r => console.error('  ' + r.slug));
      process.exit(1);
    }
    if (row.trusted === value) {
      console.log(`"${slug}" is already trusted=${value}. No change.`);
      return;
    }
    row.trusted = value;
    if (value === 'yes') {
      row.grantedAt = today();
      row.grantedBy = grantedBy;
    } else {
      row.grantedAt = '';
      row.grantedBy = '';
    }
    writeRegistry(rows);
    console.log(`"${slug}" trusted=${value}.${value === 'yes' ? ' Phase 2 injection may now use its entries.' : ''}`);
  });
}

// The Phase 2 injection gate's seam: the set of source slugs whose entries may be
// injected. Default-deny — only explicitly granted (trusted=yes) sources qualify.
function trustedSlugs() {
  return parseRegistry().rows.filter(r => r.trusted === 'yes').map(r => r.slug);
}

function isTrusted(slug) {
  return trustedSlugs().includes(slug);
}

if (require.main === module) {
  const [cmd, slug] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case 'list':   list(); break;
    case 'grant':  setTrust(slug, 'yes', 'command'); break;
    case 'revoke': setTrust(slug, 'no', 'command'); break;
    default:
      console.error(`Unknown command "${cmd}". Use: list | grant <slug> | revoke <slug>`);
      process.exit(2);
  }
}

module.exports = { parseRegistry, trustedSlugs, isTrusted, TRUST_PATH };
