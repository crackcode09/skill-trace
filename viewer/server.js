'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const Database = require('better-sqlite3');

const HOME      = homedir();
const DB_PATH   = join(HOME, '.claude', 'global-skills.db');
const MD_PATH   = join(HOME, '.claude', 'global-skills.md');
const PORT      = parseInt(process.env.GLOBAL_SKILLS_PORT || '38888', 10);
const HTML_PATH = join(__dirname, 'public', 'index.html');

// ── DB setup ──────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    date      TEXT NOT NULL,
    project   TEXT NOT NULL,
    problem   TEXT,
    solution  TEXT,
    takeaway  TEXT,
    raw       TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    title, project, problem, solution, takeaway,
    content=skills, content_rowid=id
  );
`);

// ── MD parser ─────────────────────────────────────────────────────────────────

function extractSection(body, label) {
  const re = new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function parseMd(content) {
  const entries = [];
  const blocks = content.split(/(?=^## \[)/m).filter(b => /^## \[/.test(b.trim()));
  for (const block of blocks) {
    const firstLine = block.split('\n')[0];
    const m = firstLine.match(/^## \[(\d{4}-\d{2}-\d{2})\] — (.+?)(?:\s+<!--\s*(.+?)\s*-->)?\s*$/);
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
      raw:      block.trim(),
    });
  }
  return entries;
}

// ── MD → DB sync ──────────────────────────────────────────────────────────────

function syncMdToDb() {
  if (!existsSync(MD_PATH)) {
    console.log('[global-skills] global-skills.md not found — starting with empty DB');
    return;
  }
  const content = readFileSync(MD_PATH, 'utf8');
  const entries = parseMd(content);

  const check  = db.prepare('SELECT id FROM skills WHERE title = ? AND project = ?');
  const insert = db.prepare(
    'INSERT INTO skills (title,date,project,problem,solution,takeaway,raw,synced_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  const insFts = db.prepare(
    'INSERT INTO skills_fts(rowid,title,project,problem,solution,takeaway) VALUES (?,?,?,?,?,?)'
  );

  const sync = db.transaction((rows) => {
    let added = 0;
    for (const e of rows) {
      if (check.get(e.title, e.project)) continue;
      const r = insert.run(
        e.title, e.date, e.project,
        e.problem, e.solution, e.takeaway,
        e.raw, new Date().toISOString()
      );
      insFts.run(r.lastInsertRowid, e.title, e.project,
        e.problem || '', e.solution || '', e.takeaway || '');
      added++;
    }
    return added;
  });

  const added = sync(entries);
  console.log(`[global-skills] sync complete — ${added} new entries added (${entries.length} total in MD)`);
}

syncMdToDb();

// ── HTTP server ───────────────────────────────────────────────────────────────

const stmtAll        = db.prepare('SELECT * FROM skills ORDER BY date DESC');
const stmtByProject  = db.prepare('SELECT * FROM skills WHERE project = ? ORDER BY date DESC');
const stmtSearch     = db.prepare(`
  SELECT s.* FROM skills_fts f
  JOIN skills s ON s.id = f.rowid
  WHERE skills_fts MATCH ?
  ORDER BY rank
`);
const stmtSearchProj = db.prepare(`
  SELECT s.* FROM skills_fts f
  JOIN skills s ON s.id = f.rowid
  WHERE skills_fts MATCH ? AND s.project = ?
  ORDER BY rank
`);

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

  if (url.pathname === '/api/skills') {
    const q       = url.searchParams.get('q') || '';
    const project = url.searchParams.get('project') || '';
    let rows;
    try {
      if (q && project)  rows = stmtSearchProj.all(q, project);
      else if (q)        rows = stmtSearch.all(q);
      else if (project)  rows = stmtByProject.all(project);
      else               rows = stmtAll.all();
    } catch {
      rows = [];
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify(rows));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[global-skills] viewer running at http://localhost:${PORT}`);
});
