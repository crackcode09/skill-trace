'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync, watch, writeFileSync, unlinkSync, realpathSync } = require('fs');
const { join, dirname, basename, resolve } = require('path');
const { homedir } = require('os');
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

// ── Sync: rebuild the in-memory list from the lesson store ───────────────────
//
// Source of truth is the store (one file per lesson, schema 2). The legacy single
// file at MD_PATH is handled two ways:
//   1. First run: a hand-written legacy file with no store yet is MIGRATED
//      (split into lesson files, renamed to *.legacy-<date>.md, rollup regenerated).
//   2. Hand edits: anything typed into the rollup afterwards is absorbed (any
//      entry whose body hash is not in the store is upserted, then the rollup is
//      regenerated), so editing the single file by hand stays safe.

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
  // Migrates a hand-written legacy file on first run; afterwards absorbs anything
  // typed into the rollup by hand. Same code path the sync hook uses.
  const r = store.absorbFile(MD_PATH, STORE_DIR, { generatedBy: 'hook' });
  if (r.action === 'migrated') console.log(`[global-skills] migrated legacy log — ${r.migrated} lessons (${r.merged} merged), legacy kept as ${r.legacyRenamedTo}`);
  else if (r.action === 'absorbed' && r.added) console.log(`[global-skills] absorbed ${r.added} hand-written entr${r.added === 1 ? 'y' : 'ies'} into the store`);
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

  // One lesson by id: GET returns it; DELETE removes it from the global store
  // (tombstoned so a re-sync cannot resurrect it), regenerates the rollup and
  // resyncs. Deleting here never reaches into any project's own store.
  const one = url.pathname.match(/^\/api\/lessons\/([0-9A-Z]{26})$/);
  if (one) {
    const id = one[1];
    const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${PORT}` };
    if (req.method === 'GET') {
      const s = skills.find(x => x.id === id);
      res.writeHead(s ? 200 : 404, cors);
      return res.end(JSON.stringify(s || { error: 'not found' }));
    }
    if (req.method === 'DELETE') {
      const deleted = store.deleteLesson(STORE_DIR, id);
      store.regenRollup(STORE_DIR, existsSync(MD_PATH) ? MD_PATH : undefined);
      sync();
      res.writeHead(deleted ? 200 : 404, cors);
      return res.end(JSON.stringify({ ok: deleted, id, count: skills.length }));
    }
    res.writeHead(405, { Allow: 'GET, DELETE' });
    return res.end('Method Not Allowed');
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

module.exports = { parseMd, readSchemaVersion, searchSkills, sync, toEntry, MD_PATH, STORE_DIR };
