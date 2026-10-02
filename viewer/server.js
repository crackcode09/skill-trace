'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync, watch, writeFileSync, unlinkSync, realpathSync } = require('fs');
const { join, dirname, basename, resolve } = require('path');
const { homedir } = require('os');
const { createHash } = require('crypto');
const store = require('./store.js');

const HOME      = homedir();
function realPath(p) {
  p = resolve(p);
  // realpath the deepest existing ancestor so not-yet-created files/dirs normalize too
  let probe = p; const tail = [];
  while (!existsSync(probe)) { tail.unshift(basename(probe)); const up = dirname(probe); if (up === probe) return p; probe = up; }
  try { return join(realpathSync.native(probe), ...tail); } catch { return p; }
}
const MD_PATH   = realPath(process.env.GLOBAL_SKILLS_MD_PATH || join(HOME, '.claude', 'global-skills.md')); // legacy input / generated rollup
const STORE_DIR = realPath(store.storePaths({ home: HOME }).global);                                           // ~/.claude/skill-trace
const PID_PATH  = join(HOME, '.claude', 'global-skills.pid');
const PORT      = parseInt(process.env.GLOBAL_SKILLS_PORT || '38888', 10);
const HTML_PATH = join(__dirname, 'public', 'index.html');

// In-memory store — rebuilt from MD on startup and on every file change
let skills = [];

// Highest schema version this parser understands. See docs/FORMAT.md.
const SCHEMA_VERSION = 1;

// ── MD parser ─────────────────────────────────────────────────────────────────

// File-level schema marker: `<!-- skill-trace-schema: N -->`.
// Missing marker means schema 1 (backward compatible with pre-marker files).
function readSchemaVersion(content) {
  const m = content.match(/<!--\s*skill-trace-schema:\s*(\d+)\s*-->/i);
  return m ? parseInt(m[1], 10) : 1;
}

function extractSection(body, label) {
  const re = new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

const MD_HEADER_RE = /^## (\[?\d{4}-\d{2}-\d{2}\]?)/;

function parseMd(content) {
  content = content.replace(/^﻿/, ''); // strip leading UTF-8 BOM so the first '## ' header still matches
  const entries = [];
  const blocks = content.split(/(?=^## (?:\[?\d{4}-\d{2}-\d{2}\]?))/m)
    .filter(b => MD_HEADER_RE.test(b.trim()));
  for (const block of blocks) {
    const firstLine = block.split('\n')[0];
    const m = firstLine.match(/^## \[?(\d{4}-\d{2}-\d{2})\]? — (.+?)(?:\s+<!--\s*(.+?)\s*-->)?\s*$/);
    if (!m) continue;
    const [, date, rawTitle, project = 'unknown'] = m;
    const body = block.split('\n').slice(1).join('\n');
    const stackRaw = extractSection(body, 'Stack');
    const stack = stackRaw
      ? stackRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    entries.push({
      title:    rawTitle.trim(),
      date,
      projects: project.split(',').map(p => p.trim()),
      stack,
      problem:  extractSection(body, 'Problem'),
      solution: extractSection(body, 'Solution'),
      takeaway: extractSection(body, 'Takeaway'),
    });
  }
  return entries;
}

// ── Entry key: content-hash for dedup (mirrors sync-skills logic) ────────────

function entryKey(rawBlock) {
  const lines = rawBlock.split('\n');
  const header = lines[0].trim().replace(/\s*<!--.*?-->\s*$/, '');
  const body = lines.slice(1)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('**Project:**'))
    .join('\n');
  return `${header}|${createHash('sha1').update(body, 'utf8').digest('hex').slice(0, 12)}`;
}

// ── Dedupe: collapse duplicate entries, merge provenance tags ─────────────────

function dedupeGlobal() {
  if (!existsSync(MD_PATH)) return { removed: 0, merged: 0 };
  const raw = readFileSync(MD_PATH, 'utf8').replace(/^﻿/, '');
  const introMatch = raw.match(/^([\s\S]*?)(?=^## \[?\d{4}-\d{2}-\d{2}\]?)/m);
  const intro  = introMatch ? introMatch[1] : '';
  const blocks = raw.split(/(?=^## \[?\d{4}-\d{2}-\d{2}\]?)/m)
    .filter(b => /^## \[?\d{4}-\d{2}-\d{2}\]?/.test(b))
    .map(b => b.trimEnd());

  const seen = new Map(); // key → index in kept
  const kept = [];
  let removed = 0;
  let merged  = 0;

  for (const block of blocks) {
    const key = entryKey(block);
    if (seen.has(key)) {
      const idx = seen.get(key);
      const existingProjects = ((kept[idx].split('\n')[0].match(/<!--\s*(.+?)\s*-->/) || ['',''])[1])
        .split(',').map(p => p.trim()).filter(Boolean);
      const incomingProjects = ((block.split('\n')[0].match(/<!--\s*(.+?)\s*-->/) || ['',''])[1])
        .split(',').map(p => p.trim()).filter(Boolean);
      const all = [...new Set([...existingProjects, ...incomingProjects])];
      if (all.length > existingProjects.length) {
        kept[idx] = kept[idx].replace(/<!--\s*.+?\s*-->/, `<!-- ${all.join(', ')} -->`);
        merged++;
      }
      removed++;
    } else {
      seen.set(key, kept.length);
      kept.push(block);
    }
  }

  if (removed > 0 || merged > 0) {
    writeFileSync(MD_PATH, intro + kept.join('\n\n') + '\n', 'utf8');
    sync();
  }
  return { removed, merged };
}

// ── Sync: rebuild the in-memory list from the lesson store ───────────────────
//
// Source of truth is the store (one file per lesson, schema 2). The legacy single
// file at MD_PATH is handled two ways:
//   1. First run: a hand-written legacy file with no store yet is MIGRATED
//      (split into lesson files, renamed to *.legacy-<date>.md, rollup regenerated).
//   2. Compatibility: until the hooks write to the store directly, they still
//      append schema-1 entries to the rollup. Any entry whose body hash is not in
//      the store is upserted, then the rollup is regenerated. Removed in PR C.

function metaText(l) {
  const fm = store.serializeLesson(l).split('\n---\n')[0].replace(/^---\n/, '');
  return l.edited ? fm + '\nedited: outside the tool (body hash mismatch)' : fm;
}

function toEntry(l) {
  const sec = store.sections(l);
  return {
    id: l.id, title: l.title, date: l.date, projects: l.projects, stack: l.stack,
    seen: l.seen, edited: l.edited, meta: metaText(l),
    problem: sec.problem, solution: sec.solution, takeaway: sec.takeaway,
  };
}

function absorbLegacy() {
  if (!existsSync(MD_PATH)) return;
  const content = readFileSync(MD_PATH, 'utf8');
  const hasStore = existsSync(join(STORE_DIR, 'lessons'));
  if (!store.isGenerated(MD_PATH) && !hasStore) {
    const fileVersion = readSchemaVersion(content);
    if (fileVersion > SCHEMA_VERSION) console.log(`[global-skills] legacy file schema v${fileVersion} newer than v${SCHEMA_VERSION} — migrating best-effort`);
    const r = store.migrateLegacy(MD_PATH, STORE_DIR);
    console.log(`[global-skills] migrated legacy log — ${r.migrated} lessons (${r.merged} merged), legacy kept as ${r.legacyRenamedTo}`);
    return;
  }
  // compat: pick up entries the hooks appended to the rollup / legacy file
  const known = new Set(store.loadStore(STORE_DIR).lessons.map(l => l.hash));
  let added = 0;
  for (const e of store.parseLegacyMd(content)) {
    if (known.has(store.bodyHash(e.body))) continue;
    const r = store.upsertGlobal(STORE_DIR, {
      id: store.ulid(), type: 'Lesson', schema: store.SCHEMA, title: e.title, date: e.date, stack: e.stack,
      projects: e.projects, seen: 1, created: `${e.date}T00:00:00Z`,
      updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      body: e.body, hash: store.bodyHash(e.body),
    });
    if (r.action !== 'tombstoned') added++;
  }
  if (added || !store.isGenerated(MD_PATH)) {
    store.regenRollup(STORE_DIR, MD_PATH);
    if (added) console.log(`[global-skills] absorbed ${added} legacy-appended entr${added === 1 ? 'y' : 'ies'} into the store`);
  }
}

function sync() {
  try { absorbLegacy(); } catch (err) { console.log(`[global-skills] legacy absorb failed: ${err.message}`); }
  const { lessons, warnings } = store.loadStore(STORE_DIR);
  for (const w of warnings) console.log(`[global-skills] skipped ${w}`);
  skills = lessons.map(toEntry);
  console.log(`[global-skills] synced — ${skills.length} entries`);
}

// ── Live watch: re-sync when the store or the legacy/rollup file changes ──────
// Watchers are armed lazily: the lessons dir and the rollup may not exist yet on
// a fresh install, so a watcher on ~/.claude re-arms them when they appear.

let debounce = null;
const watchers = new Map(); // path → FSWatcher

function scheduleSync(why) {
  clearTimeout(debounce);
  debounce = setTimeout(() => { console.log(`[global-skills] ${why} — resyncing`); sync(); }, 500);
}

// Always watch a DIRECTORY (file watches are fragile on Windows and macOS);
// `onlyFile` narrows the events to one basename inside it.
function armWatch(dir, why, onlyFile) {
  const key = dir + (onlyFile ? '#' + onlyFile : '');
  if (watchers.has(key) || !existsSync(dir)) return;
  try {
    watchers.set(key, watch(dir, (ev, fname) => {
      if (onlyFile && fname && String(fname) !== onlyFile) return;
      scheduleSync(why);
    }));
  } catch (err) { console.log(`[global-skills] watch failed for ${dir}: ${err.message}`); }
}

function armAll() {
  armWatch(join(STORE_DIR, 'lessons'), 'store changed');
  armWatch(dirname(MD_PATH), 'legacy/rollup file changed', basename(MD_PATH));
}

// Invoked only when run as the server process.
function startWatchers() {
  armAll();
  try { watch(realPath(join(HOME, '.claude')), () => armAll()); } catch {}   // first creation of either
  try { if (existsSync(STORE_DIR)) watch(STORE_DIR, () => armAll()); } catch {} // first creation of lessons/
}

// ── Search: case-insensitive substring across every field a user can see ──────
// Title, the three body sections, Stack tags and project slugs. Anything shown
// on an entry should be findable by typing it.

function searchSkills(q, project) {
  const lower = q.toLowerCase();
  return skills.filter(s => {
    if (project && !s.projects.includes(project)) return false;
    return (
      s.title.toLowerCase().includes(lower) ||
      (s.problem  && s.problem.toLowerCase().includes(lower))  ||
      (s.solution && s.solution.toLowerCase().includes(lower)) ||
      (s.takeaway && s.takeaway.toLowerCase().includes(lower)) ||
      (s.stack && s.stack.join(' ').includes(lower)) ||
      s.projects.join(' ').toLowerCase().includes(lower)
    );
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    try {
      const html = readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      res.writeHead(500);
      return res.end('index.html not found');
    }
  }

  if (url.pathname === '/api/sync') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end('Method Not Allowed');
    }
    sync();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${PORT}` });
    return res.end(JSON.stringify({ ok: true, count: skills.length }));
  }

  if (url.pathname === '/api/skills') {
    const q       = url.searchParams.get('q') || '';
    const project = url.searchParams.get('project') || '';
    const limit   = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const offset  = parseInt(url.searchParams.get('offset') || '0', 10);

    let results;
    if (q) {
      results = searchSkills(q, project);
    } else if (project) {
      results = skills.filter(s => s.projects.includes(project));
    } else {
      results = skills;
    }

    results = results.slice(offset, offset + limit);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${PORT}` });
    return res.end(JSON.stringify(results));
  }

  if (url.pathname === '/api/dedupe') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end('Method Not Allowed');
    }
    const result = existsSync(join(STORE_DIR, 'lessons')) ? { removed: 0, merged: 0, note: 'store dedups on write' } : dedupeGlobal();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${PORT}` });
    return res.end(JSON.stringify({ ok: true, ...result }));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[global-skills] port ${PORT} already in use — exiting cleanly`);
    process.exit(0);
  }
  throw err;
});

function cleanup() {
  try { unlinkSync(PID_PATH); } catch {}
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Only boot the server when run directly (`node server.js`). When required by a
// test, nothing listens — the pure functions below are exercised in isolation.

function main() {
  sync();
  startWatchers();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[global-skills] viewer running at http://localhost:${PORT}`);
    try { writeFileSync(PID_PATH, String(process.pid)); } catch {}
  });
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

if (require.main === module) main();

module.exports = { parseMd, readSchemaVersion, entryKey, dedupeGlobal, searchSkills, sync, toEntry, MD_PATH, STORE_DIR };
