'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync, watch, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const HOME      = homedir();
const MD_PATH   = join(HOME, '.claude', 'global-skills.md');
const PID_PATH  = join(HOME, '.claude', 'global-skills.pid');
const PORT      = parseInt(process.env.GLOBAL_SKILLS_PORT || '38888', 10);
const HTML_PATH = join(__dirname, 'public', 'index.html');

// In-memory store — rebuilt from MD on startup and on every file change
let skills = [];

// ── MD parser ─────────────────────────────────────────────────────────────────

function extractSection(body, label) {
  const re = new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

const MD_HEADER_RE = /^## (\[?\d{4}-\d{2}-\d{2}\]?)/;

function parseMd(content) {
  const entries = [];
  const blocks = content.split(/(?=^## (?:\[?\d{4}-\d{2}-\d{2}\]?))/m)
    .filter(b => MD_HEADER_RE.test(b.trim()));
  for (const block of blocks) {
    const firstLine = block.split('\n')[0];
    const m = firstLine.match(/^## \[?(\d{4}-\d{2}-\d{2})\]? — (.+?)(?:\s+<!--\s*(.+?)\s*-->)?\s*$/);
    if (!m) continue;
    const [, date, rawTitle, project = 'unknown'] = m;
    const body = block.split('\n').slice(1).join('\n');
    entries.push({
      title:    rawTitle.trim(),
      date,
      project:  project.trim(),
      problem:  extractSection(body, 'Problem'),
      solution: extractSection(body, 'Solution'),
      takeaway: extractSection(body, 'Takeaway'),
    });
  }
  return entries;
}

// ── Sync: rebuild in-memory store from MD ────────────────────────────────────

function sync() {
  if (!existsSync(MD_PATH)) {
    skills = [];
    console.log('[global-skills] global-skills.md not found — empty store');
    return;
  }
  const entries = parseMd(readFileSync(MD_PATH, 'utf8'));
  entries.sort((a, b) => b.date.localeCompare(a.date));
  skills = entries.map((e, i) => ({ id: i + 1, ...e }));
  console.log(`[global-skills] synced — ${skills.length} entries`);
}

sync();

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

armFileWatch(); // works immediately if the file already exists

// Directory watch detects first creation of global-skills.md
try {
  watch(join(HOME, '.claude'), (event, filename) => {
    if (filename === 'global-skills.md') armFileWatch();
  });
} catch {
  // directory may not exist yet on a brand-new install — not fatal
}

// ── Search: case-insensitive substring across all text fields ─────────────────

function searchSkills(q, project) {
  const lower = q.toLowerCase();
  return skills.filter(s => {
    if (project && s.project !== project) return false;
    return (
      s.title.toLowerCase().includes(lower) ||
      (s.problem  && s.problem.toLowerCase().includes(lower))  ||
      (s.solution && s.solution.toLowerCase().includes(lower)) ||
      (s.takeaway && s.takeaway.toLowerCase().includes(lower))
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
      results = skills.filter(s => s.project === project);
    } else {
      results = skills;
    }

    results = results.slice(offset, offset + limit);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${PORT}` });
    return res.end(JSON.stringify(results));
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[global-skills] viewer running at http://localhost:${PORT}`);
  try { writeFileSync(PID_PATH, String(process.pid)); } catch {}
});

function cleanup() {
  try { unlinkSync(PID_PATH); } catch {}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
