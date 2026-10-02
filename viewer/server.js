'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync, watch, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { createHash } = require('crypto');

const HOME      = homedir();
const MD_PATH   = process.env.GLOBAL_SKILLS_MD_PATH || join(HOME, '.claude', 'global-skills.md');
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

// ── Sync: rebuild in-memory store from MD ────────────────────────────────────

function sync() {
  if (!existsSync(MD_PATH)) {
    skills = [];
    console.log('[global-skills] global-skills.md not found — empty store');
    return;
  }
  const content = readFileSync(MD_PATH, 'utf8');
  const fileVersion = readSchemaVersion(content);
  if (fileVersion > SCHEMA_VERSION) {
    console.log(`[global-skills] file schema v${fileVersion} is newer than parser v${SCHEMA_VERSION} — parsing best-effort as v1`);
  }
  const entries = parseMd(content);
  entries.sort((a, b) => b.date.localeCompare(a.date));
  skills = entries.map((e, i) => ({ id: i + 1, ...e }));
  console.log(`[global-skills] synced — ${skills.length} entries`);
}

// ── Live watch: re-sync when MD changes ──────────────────────────────────────
// Two-layer strategy: file watcher for fast change detection; directory watcher
// to arm the file watcher the first time global-skills.md is created.

let debounce = null;
let fileWatcher = null;

function armFileWatch() {
  if (fileWatcher || !existsSync(MD_PATH)) return;
  try {
    fileWatcher = watch(MD_PATH, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log('[global-skills] MD changed — resyncing');
        sync();
      }, 500);
    });
  } catch (err) {
    console.log(`[global-skills] file watch failed: ${err.message}`);
  }
}

// Start file + directory watchers. Invoked only when run as the server process.
function startWatchers() {
  armFileWatch(); // works immediately if the file already exists
  // Directory watch detects first creation of global-skills.md
  try {
    watch(join(HOME, '.claude'), (event, filename) => {
      if (filename === 'global-skills.md') armFileWatch();
    });
  } catch {
    // directory may not exist yet on a brand-new install — not fatal
  }
}

// ── Search: case-insensitive substring across all text fields ─────────────────

function searchSkills(q, project) {
  const lower = q.toLowerCase();
  return skills.filter(s => {
    if (project && !s.projects.includes(project)) return false;
    return (
      s.title.toLowerCase().includes(lower) ||
      (s.problem  && s.problem.toLowerCase().includes(lower))  ||
      (s.solution && s.solution.toLowerCase().includes(lower)) ||
      (s.takeaway && s.takeaway.toLowerCase().includes(lower)) ||
      (s.stack && s.stack.join(' ').includes(lower))
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
    const result = dedupeGlobal();
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

module.exports = { parseMd, readSchemaVersion, entryKey, dedupeGlobal, searchSkills, sync, MD_PATH };
