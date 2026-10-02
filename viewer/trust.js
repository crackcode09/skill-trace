'use strict';

// skill-trace trust CLI — the ONLY automated way to flip a source's trust flag.
//
//   node trust.js                 list the registry
//   node trust.js grant  <slug>   flip no -> yes (granted-by=command), then sync that project
//   node trust.js revoke <slug>   flip yes -> no
//
// Invariants (see docs/TRUST.md): this tool acts ONLY on the slug a human passes
// on the command line. It never reads the skills log, never infers trust from
// file content. The sync hook only ever RECORDS a source (as `no`); it never
// grants. Trust gates which projects reach the global store (and, later,
// injection) — capture into a project's own store is never gated.

const { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync,
        openSync, closeSync, unlinkSync, statSync, appendFileSync } = require('fs');
const { join, dirname, basename } = require('path');
const { homedir } = require('os');

const TRUST_PATH = process.env.SKILL_TRACE_TRUST_PATH ||
  join(homedir(), '.claude', 'skill-trace-trust.txt');

// Where each source was last seen on disk (slug | path). Not a trust input —
// only a locator so `grant` can sync the project immediately.
const SOURCES_PATH = process.env.SKILL_TRACE_SOURCES_PATH ||
  join(dirname(TRUST_PATH), basename(TRUST_PATH).replace(/trust\.txt$/, 'sources.txt'));

const HEADER = [
  '# skill-trace source trust registry',
  '# columns: project-slug | trusted(yes|no) | first-seen | granted-at | granted-by',
  "# The sync hook only ever ADDS rows as 'no'. Granting trust (no -> yes) is done",
  '# ONLY by you: the /skill-trust command or editing this file. Only trusted',
  '# sources sync into the global store. Trust is never decided from synced content.',
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

// ── Sync-wide lock ────────────────────────────────────────────────────────────
// One lock guards the registry, the sources file and every store write done by
// a sync, so concurrent hooks/CLI calls serialize. Bounded wait (real sleep, not
// a spin); a lock older than 15s is considered abandoned and stolen. Not
// re-entrant: callers already inside withLock pass `{ locked: true }` to helpers.

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) { Atomics.wait(sleepBuf, 0, 0, ms); }

function withLock(fn, { maxWaitMs = 1500 } = {}) {
  const lock = TRUST_PATH + '.lock';
  const dir = dirname(TRUST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let acquired = false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try { closeSync(openSync(lock, 'wx')); acquired = true; break; }
    catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) { unlinkSync(lock); continue; } }
      catch { /* lock vanished — retry */ }
      sleep(25);
    }
  }
  try { return fn(); }
  finally { if (acquired) { try { unlinkSync(lock); } catch { /* already gone */ } } }
}

// ── Sources (slug → last seen path) ───────────────────────────────────────────

function readSources() {
  const map = new Map();
  if (!existsSync(SOURCES_PATH)) return map;
  for (const line of readFileSync(SOURCES_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('|');
    if (i > 0) map.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return map;
}

function writeSources(map) {
  const dir = dirname(SOURCES_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = [...map.entries()].map(([s, p]) => `${s} | ${p}`).join('\n');
  writeFileSync(SOURCES_PATH, '# skill-trace sources: project-slug | last seen path (locator only; not a trust input)\n' + body + (body ? '\n' : ''), 'utf8');
}

function sourcePath(slug) { return readSources().get(slug) || null; }

// Record a source. Adds a registry row as `no` if absent (never flips an
// existing row) and remembers where the project lives. Hooks call this.
function recordSource(slug, projectPath, { locked = false } = {}) {
  if (!slug) return;
  const run = () => {
    const { rows } = parseRegistry();
    if (!rows.find(r => r.slug === slug)) {
      rows.push({ slug, trusted: 'no', firstSeen: today(), grantedAt: '', grantedBy: '' });
      writeRegistry(rows);
    }
    if (projectPath) {
      const map = readSources();
      if (map.get(slug) !== projectPath) { map.set(slug, projectPath); writeSources(map); }
    }
  };
  return locked ? run() : withLock(run);
}

// ── Commands ──────────────────────────────────────────────────────────────────

function list() {
  const { rows } = parseRegistry();
  if (!rows.length) {
    console.log('No sources recorded yet. Save a lesson in a project, then grant it trust.');
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
  const changed = withLock(() => {
    const { rows } = parseRegistry();
    const row = rows.find(r => r.slug === slug);
    if (!row) {
      console.error(`Source "${slug}" is not in the registry. It is recorded automatically the first time a lesson is saved there. Known sources:`);
      rows.forEach(r => console.error('  ' + r.slug));
      process.exit(1);
    }
    if (row.trusted === value) {
      console.log(`"${slug}" is already trusted=${value}. No change.`);
      return false;
    }
    row.trusted = value;
    if (value === 'yes') { row.grantedAt = today(); row.grantedBy = grantedBy; }
    else { row.grantedAt = ''; row.grantedBy = ''; }
    writeRegistry(rows);
    return true;
  });
  if (!changed) return;
  if (value === 'yes') {
    console.log(`"${slug}" trusted=yes. Its lessons now sync into the global store.`);
    const p = sourcePath(slug);
    if (p && existsSync(p)) {
      try {
        const r = require('./store.js').syncProject(p, slug); // lazy: store requires this module
        console.log(`Synced ${r.synced} lesson${r.synced === 1 ? '' : 's'} from ${p}.`);
      } catch (err) { console.log(`(sync skipped: ${err.message})`); }
    } else {
      console.log('Existing lessons will sync the next time that project saves one, or run `node store.js sync` inside it.');
    }
  } else {
    console.log(`"${slug}" trusted=no. Future saves there stay local; already-synced lessons are kept.`);
  }
}

// The injection gate's seam: the set of source slugs whose lessons may be used.
// Default-deny — only explicitly granted (trusted=yes) sources qualify.
function trustedSlugs() {
  return parseRegistry().rows.filter(r => r.trusted === 'yes').map(r => r.slug);
}

function isTrusted(slug) {
  return trustedSlugs().includes(slug);
}

// Exports are assigned BEFORE the CLI block: `grant` lazily requires store.js,
// which requires this module back; the exports must already be populated then.
module.exports = { parseRegistry, trustedSlugs, isTrusted, withLock, recordSource, sourcePath, TRUST_PATH, SOURCES_PATH };

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
