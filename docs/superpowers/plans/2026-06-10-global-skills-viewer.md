# global-skills v1.1.0 — Viewer + SQLite + GitHub Publish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local web viewer (port 38888) to the global-skills Claude Code plugin, backed by SQLite/FTS5 search, starting automatically on session start, and prepare the plugin for public GitHub publishing.

**Architecture:** Flat `global-skills.md` stays as the canonical source written by the existing PostToolUse hook. On viewer startup, `server.js` parses the MD file and upserts new entries into a SQLite DB (`~/.claude/global-skills.db`) with FTS5 for fast search. The viewer serves a 3-column split-pane UI (projects | entry list | detail panel) over `http://localhost:38888`.

**Tech Stack:** Node.js (CJS, no build step), `better-sqlite3` (SQLite + FTS5), vanilla HTML/CSS/JS, PowerShell (SessionStart hook).

---

## File Map

| File (in `global-skills-plugin/`) | Deploy to (`~/.claude/skills/global-skills/`) | Action |
|---|---|---|
| `viewer/package.json` | `viewer/package.json` | CREATE |
| `viewer/server.js` | `viewer/server.js` | CREATE |
| `viewer/public/index.html` | `viewer/public/index.html` | CREATE |
| `hooks/scripts/start-viewer.ps1` | `hooks/scripts/start-viewer.ps1` | CREATE |
| `hooks/hooks.json` | `hooks/hooks.json` | MODIFY |
| `.claude-plugin/plugin.json` | `.claude-plugin/plugin.json` | MODIFY |
| `README.md` | `README.md` | REWRITE |
| `LICENSE` | `LICENSE` | CREATE |
| `CHANGELOG.md` | `CHANGELOG.md` | CREATE |
| `.gitignore` | `.gitignore` | CREATE |

**Runtime files (never in git):**
- `~/.claude/global-skills.db` — created at runtime by `server.js`
- `~/.claude/skills/global-skills/viewer/node_modules/` — created by `npm install`

---

## Task 1: viewer/package.json

**Files:**
- Create: `viewer/package.json`

- [ ] **Step 1.1: Create package.json**

```json
{
  "name": "global-skills-viewer",
  "version": "1.1.0",
  "description": "Local web viewer for the global-skills log",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.6.0"
  }
}
```

Write to: `viewer/package.json`

- [ ] **Step 1.2: Verify npm install works**

```powershell
cd "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\viewer"
npm install
```

Expected: `node_modules/better-sqlite3/` created, no errors.

- [ ] **Step 1.3: Commit**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add viewer/package.json
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add viewer package.json with better-sqlite3"
```

---

## Task 2: viewer/server.js — SQLite schema + MD sync

**Files:**
- Create: `viewer/server.js`

This task builds the DB setup and MD parser. The HTTP server is added in Task 3.

- [ ] **Step 2.1: Create server.js with schema init and MD parser**

Write `viewer/server.js`:

```javascript
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
  // Split on entry headers: ## [YYYY-MM-DD] — Title <!-- project -->
  const blocks = content.split(/(?=^## \[)/m).filter(b => /^## \[/.test(b.trim()));
  for (const block of blocks) {
    const firstLine = block.split('\n')[0];
    const m = firstLine.match(/^## \[(\d{4}-\d{2}-\d{2})\] — (.+?)(?:\s+<!--\s*(.+?)\s*-->)?\s*$/);
    if (!m) continue;
    const [, date, rawTitle, project = 'unknown'] = m;
    const title   = rawTitle.trim();
    const body    = block.split('\n').slice(1).join('\n');
    entries.push({
      title,
      date,
      project: project.trim(),
      problem:  extractSection(body, 'Problem'),
      solution: extractSection(body, 'Solution'),
      takeaway: extractSection(body, 'Takeaway'),
      raw: block.trim(),
    });
  }
  return entries;
}

// ── MD → DB sync ──────────────────────────────────────────────────────────────

function syncMdToDb() {
  if (!existsSync(MD_PATH)) {
    console.log('[global-skills] global-skills.md not found — nothing to sync');
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
      const r = insert.run(e.title, e.date, e.project, e.problem, e.solution, e.takeaway, e.raw, new Date().toISOString());
      insFts.run(r.lastInsertRowid, e.title, e.project, e.problem || '', e.solution || '', e.takeaway || '');
      added++;
    }
    return added;
  });

  const added = sync(entries);
  console.log(`[global-skills] sync complete — ${added} new entries added (${entries.length} total in MD)`);
}

syncMdToDb();

// HTTP server added in next task — placeholder to allow manual testing of DB sync:
// Run: node viewer/server.js
// Expected: sync log line printed, ~/.claude/global-skills.db created
```

- [ ] **Step 2.2: Test DB sync manually**

```powershell
cd "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\viewer"
node -e "require('./server.js')"
```

Expected output:
```
[global-skills] sync complete — N new entries added (N total in MD)
```

Also verify DB created:
```powershell
Test-Path "$env:USERPROFILE\.claude\global-skills.db"
# Expected: True
```

- [ ] **Step 2.3: Verify DB contents**

```powershell
node -e "
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.USERPROFILE, '.claude', 'global-skills.db'));
console.log(db.prepare('SELECT id,title,project,date FROM skills LIMIT 5').all());
"
```

Expected: array of skill objects with title, project, date populated.

- [ ] **Step 2.4: Commit**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add viewer/server.js
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add viewer server with SQLite schema and MD sync"
```

---

## Task 3: viewer/server.js — HTTP server + API

**Files:**
- Modify: `viewer/server.js` (append HTTP server section)

- [ ] **Step 3.1: Replace the placeholder comment at bottom of server.js with the HTTP server**

Replace the comment block at the bottom of `viewer/server.js` (starting with `// HTTP server added in next task`) with:

```javascript
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
    const html = readFileSync(HTML_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (url.pathname === '/api/skills') {
    const q       = url.searchParams.get('q') || '';
    const project = url.searchParams.get('project') || '';
    let rows;
    try {
      if (q && project)       rows = stmtSearchProj.all(q, project);
      else if (q)             rows = stmtSearch.all(q);
      else if (project)       rows = stmtByProject.all(project);
      else                    rows = stmtAll.all();
    } catch (err) {
      // FTS5 MATCH syntax error — return empty rather than crash
      rows = [];
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(rows));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[global-skills] viewer running at http://localhost:${PORT}`);
});
```

- [ ] **Step 3.2: Create a placeholder index.html so the server can start**

Write `viewer/public/index.html` (temporary — full UI in Task 4):

```html
<!DOCTYPE html>
<html><body><h1>global-skills viewer — coming soon</h1></body></html>
```

- [ ] **Step 3.3: Start server and test API**

```powershell
cd "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\viewer"
Start-Process "node" -ArgumentList "server.js" -PassThru
Start-Sleep 2
# Test all-skills endpoint
Invoke-RestMethod "http://localhost:38888/api/skills" | ConvertTo-Json | Select-Object -First 20
```

Expected: JSON array of skill objects.

```powershell
# Test project filter
Invoke-RestMethod "http://localhost:38888/api/skills?project=rma_process_automate" | ConvertTo-Json
```

```powershell
# Test FTS search
Invoke-RestMethod "http://localhost:38888/api/skills?q=sql" | ConvertTo-Json
```

Expected: entries matching "sql" in title/problem/solution/takeaway.

- [ ] **Step 3.4: Stop test server and commit**

```powershell
# Kill the test node process
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*server.js*" } | Stop-Process -Force

git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add viewer/server.js viewer/public/index.html
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add HTTP server with /api/skills endpoint"
```

---

## Task 4: viewer/public/index.html — Full UI

**Files:**
- Modify: `viewer/public/index.html` (replace placeholder with full UI)

- [ ] **Step 4.1: Write the full 3-column viewer UI**

Replace `viewer/public/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Global Skills Log</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: #0d1117;
    color: #c9d1d9;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Top bar ── */
  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
  }
  .topbar h1 { font-size: 15px; font-weight: 600; color: #f0f6fc; white-space: nowrap; }
  .topbar input {
    flex: 1;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 10px;
    color: #c9d1d9;
    font-size: 13px;
    outline: none;
  }
  .topbar input:focus { border-color: #58a6ff; }
  .topbar input::placeholder { color: #484f58; }

  /* ── 3-column body ── */
  .columns {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Projects column ── */
  .col-projects {
    width: 180px;
    flex-shrink: 0;
    background: #161b22;
    border-right: 1px solid #30363d;
    overflow-y: auto;
    padding: 8px 0;
  }
  .col-projects .col-header {
    padding: 4px 12px 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .08em;
    color: #484f58;
    text-transform: uppercase;
  }
  .project-item {
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 4px;
    margin: 1px 6px;
  }
  .project-item:hover { background: #1c2128; }
  .project-item.active { background: #1f6feb; color: #fff; }
  .project-item .count {
    font-size: 10px;
    background: rgba(255,255,255,.12);
    border-radius: 10px;
    padding: 1px 6px;
  }
  .project-item.active .count { background: rgba(255,255,255,.25); }

  /* ── Entry list column ── */
  .col-entries {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid #30363d;
    overflow-y: auto;
    background: #0d1117;
  }
  .col-entries .col-header {
    padding: 10px 12px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .08em;
    color: #484f58;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    background: #0d1117;
    border-bottom: 1px solid #21262d;
  }
  .entry-item {
    padding: 10px 12px;
    border-bottom: 1px solid #21262d;
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  .entry-item:hover { background: #161b22; }
  .entry-item.active {
    background: #161b22;
    border-left-color: #58a6ff;
  }
  .entry-item .entry-title {
    font-size: 12px;
    font-weight: 500;
    color: #e6edf3;
    margin-bottom: 3px;
    line-height: 1.3;
  }
  .entry-item .entry-meta {
    font-size: 10px;
    color: #484f58;
  }
  .entry-item .entry-project-tag {
    display: inline-block;
    font-size: 9px;
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 3px;
    padding: 1px 4px;
    color: #8b949e;
    margin-top: 3px;
  }
  .empty-state {
    padding: 24px 12px;
    font-size: 12px;
    color: #484f58;
    text-align: center;
  }

  /* ── Detail column ── */
  .col-detail {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    background: #0d1117;
  }
  .detail-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #484f58;
    font-size: 13px;
  }
  .detail-title {
    font-size: 17px;
    font-weight: 600;
    color: #f0f6fc;
    margin-bottom: 6px;
    line-height: 1.3;
  }
  .detail-meta {
    font-size: 11px;
    color: #484f58;
    margin-bottom: 20px;
    display: flex;
    gap: 12px;
  }
  .detail-meta .tag {
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 7px;
    color: #8b949e;
  }
  .detail-section { margin-bottom: 20px; }
  .detail-section .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: #58a6ff;
    margin-bottom: 6px;
  }
  .detail-section .section-body {
    font-size: 13px;
    color: #c9d1d9;
    line-height: 1.6;
  }
  .detail-section .section-body code {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: monospace;
    font-size: 12px;
    color: #79c0ff;
  }

  /* ── Footer ── */
  .footer {
    padding: 5px 16px;
    background: #161b22;
    border-top: 1px solid #30363d;
    font-size: 10px;
    color: #484f58;
    display: flex;
    gap: 16px;
    flex-shrink: 0;
  }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
</style>
</head>
<body>

<div class="topbar">
  <h1>🎓 Global Skills Log</h1>
  <input type="text" id="search" placeholder="Search entries...">
</div>

<div class="columns">
  <div class="col-projects" id="projectList">
    <div class="col-header">Projects</div>
  </div>
  <div class="col-entries" id="entryList">
    <div class="col-header">Entries</div>
  </div>
  <div class="col-detail" id="detailPanel">
    <div class="detail-placeholder">Select an entry to view details</div>
  </div>
</div>

<div class="footer">
  <span>http://localhost:38888</span>
  <span id="footerCount">Loading...</span>
</div>

<script>
'use strict';

let allSkills    = [];
let filtered     = [];
let activeProject = 'All';
let activeId      = null;
let searchTimer   = null;

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchSkills(q = '', project = '') {
  const params = new URLSearchParams();
  if (q)       params.set('q', q);
  if (project && project !== 'All') params.set('project', project);
  const res = await fetch('/api/skills?' + params.toString());
  return res.json();
}

// ── Render: project list ──────────────────────────────────────────────────────

function renderProjects(skills) {
  const counts = {};
  for (const s of allSkills) {
    counts[s.project] = (counts[s.project] || 0) + 1;
  }
  const projects = Object.keys(counts).sort();

  const list = document.getElementById('projectList');
  list.innerHTML = '<div class="col-header">Projects</div>';

  const allItem = makeProjectItem('All', allSkills.length, activeProject === 'All');
  list.appendChild(allItem);

  for (const p of projects) {
    const inFiltered = skills.filter(s => s.project === p).length;
    list.appendChild(makeProjectItem(p, inFiltered, activeProject === p));
  }
}

function makeProjectItem(name, count, active) {
  const div = document.createElement('div');
  div.className = 'project-item' + (active ? ' active' : '');
  div.innerHTML = `<span>${name}</span><span class="count">${count}</span>`;
  div.addEventListener('click', () => selectProject(name));
  return div;
}

// ── Render: entry list ────────────────────────────────────────────────────────

function renderEntries(skills) {
  const list = document.getElementById('entryList');
  list.innerHTML = '<div class="col-header">Entries</div>';

  if (!skills.length) {
    list.innerHTML += '<div class="empty-state">No entries found</div>';
    document.getElementById('detailPanel').innerHTML = '<div class="detail-placeholder">No entries found</div>';
    return;
  }

  for (const s of skills) {
    const div = document.createElement('div');
    div.className = 'entry-item' + (s.id === activeId ? ' active' : '');
    div.dataset.id = s.id;
    div.innerHTML = `
      <div class="entry-title">${esc(s.title)}</div>
      <div class="entry-meta">${s.date}</div>
      ${activeProject === 'All' ? `<span class="entry-project-tag">${esc(s.project)}</span>` : ''}
    `;
    div.addEventListener('click', () => selectEntry(s));
    list.appendChild(div);
  }

  document.getElementById('footerCount').textContent =
    `${skills.length} entr${skills.length === 1 ? 'y' : 'ies'} · global-skills v1.1.0`;
}

// ── Render: detail panel ──────────────────────────────────────────────────────

function renderDetail(s) {
  const panel = document.getElementById('detailPanel');
  panel.innerHTML = `
    <div class="detail-title">${esc(s.title)}</div>
    <div class="detail-meta">
      <span class="tag">${esc(s.project)}</span>
      <span class="tag">${s.date}</span>
    </div>
    ${section('Problem', s.problem)}
    ${section('Solution', s.solution)}
    ${section('Takeaway', s.takeaway)}
  `;
}

function section(label, text) {
  if (!text) return '';
  return `
    <div class="detail-section">
      <div class="section-label">${label}</div>
      <div class="section-body">${renderInlineMarkdown(esc(text))}</div>
    </div>
  `;
}

function renderInlineMarkdown(html) {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Interactions ──────────────────────────────────────────────────────────────

async function selectProject(name) {
  activeProject = name;
  activeId = null;
  const q = document.getElementById('search').value.trim();
  filtered = await fetchSkills(q, name === 'All' ? '' : name);
  renderProjects(filtered);
  renderEntries(filtered);
  document.getElementById('detailPanel').innerHTML = '<div class="detail-placeholder">Select an entry to view details</div>';
}

function selectEntry(s) {
  activeId = s.id;
  document.querySelectorAll('.entry-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.id) === activeId);
  });
  renderDetail(s);
}

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = e.target.value.trim();
    const project = activeProject === 'All' ? '' : activeProject;
    filtered = await fetchSkills(q, project);
    renderEntries(filtered);
    // Update project counts without resetting active
    renderProjects(filtered);
  }, 250);
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  allSkills = await fetchSkills();
  filtered  = allSkills;
  renderProjects(allSkills);
  renderEntries(allSkills);
  document.getElementById('footerCount').textContent =
    `${allSkills.length} entries · global-skills v1.1.0`;
}

init();
</script>
</body>
</html>
```

- [ ] **Step 4.2: Start server and test in browser**

```powershell
cd "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\viewer"
Start-Process "node" -ArgumentList "server.js"
Start-Sleep 2
Start-Process "http://localhost:38888"
```

Verify:
- 3 columns render (Projects | Entries | Detail)
- Projects list shows project names with counts
- Clicking a project filters the entry list
- Clicking an entry shows Problem/Solution/Takeaway in detail panel
- Search box filters entries

- [ ] **Step 4.3: Stop server and commit**

```powershell
Get-Process -Name "node" | Stop-Process -Force

git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add viewer/public/index.html
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add 3-column viewer UI with search and detail panel"
```

---

## Task 5: hooks/scripts/start-viewer.ps1

**Files:**
- Create: `hooks/scripts/start-viewer.ps1`

- [ ] **Step 5.1: Create start-viewer.ps1**

```powershell
# start-viewer.ps1
# Starts the global-skills viewer in background on port 38888.
# Runs npm install on first use. Skips silently if port already occupied.
param()

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$port = 38888

# Skip if port already in use
$inUse = netstat -ano 2>$null | Select-String ":$port\s"
if ($inUse) { exit 0 }

$script_dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer_dir = [System.IO.Path]::GetFullPath((Join-Path $script_dir "..\..\viewer"))
$server     = Join-Path $viewer_dir "server.js"
$node_mods  = Join-Path $viewer_dir "node_modules"
$pkg        = Join-Path $viewer_dir "package.json"

if (-not (Test-Path $server)) { exit 0 }

# One-time npm install (only if package.json exists and node_modules missing)
if ((Test-Path $pkg) -and (-not (Test-Path $node_mods))) {
    try {
        Push-Location $viewer_dir
        npm install --silent --no-progress 2>$null
    } finally {
        Pop-Location
    }
}

Start-Process "node" -ArgumentList "`"$server`"" -WindowStyle Hidden -WorkingDirectory $viewer_dir
exit 0
```

Write to: `hooks/scripts/start-viewer.ps1`

- [ ] **Step 5.2: Test the script manually**

```powershell
$scriptPath = "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\hooks\scripts\start-viewer.ps1"
powershell -ExecutionPolicy Bypass -NonInteractive -File $scriptPath
Start-Sleep 3
Invoke-RestMethod "http://localhost:38888/api/skills" | Measure-Object | Select-Object Count
```

Expected: `Count` > 0 (server started successfully in background).

```powershell
# Clean up
Get-Process -Name "node" | Stop-Process -Force
```

- [ ] **Step 5.3: Commit**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add hooks/scripts/start-viewer.ps1
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add start-viewer.ps1 SessionStart hook script"
```

---

## Task 6: hooks/hooks.json — Add SessionStart

**Files:**
- Create in project: `hooks/hooks.json` (will replace existing in deploy target)

The current `~/.claude/skills/global-skills/hooks/hooks.json` has only `PostToolUse`. We need to add `SessionStart`.

- [ ] **Step 6.1: Read current hooks.json**

```powershell
Get-Content "C:\Users\NidhinD\.claude\skills\global-skills\hooks\hooks.json"
```

- [ ] **Step 6.2: Write updated hooks.json in project dir**

Write `hooks/hooks.json`:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write",
      "hooks": [
        {
          "type": "command",
          "command": "powershell -ExecutionPolicy Bypass -NonInteractive -File \"$CLAUDE_PLUGIN_ROOT/hooks/scripts/sync-skills.ps1\"",
          "timeout": 15
        }
      ]
    },
    {
      "matcher": "Edit",
      "hooks": [
        {
          "type": "command",
          "command": "powershell -ExecutionPolicy Bypass -NonInteractive -File \"$CLAUDE_PLUGIN_ROOT/hooks/scripts/sync-skills.ps1\"",
          "timeout": 15
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "powershell -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File \"$CLAUDE_PLUGIN_ROOT/hooks/scripts/start-viewer.ps1\"",
          "timeout": 30
        }
      ]
    }
  ]
}
```

> **Note:** The `PostToolUse` entries are copied from the current `hooks.json`. Verify their exact content in Step 6.1 before writing.

- [ ] **Step 6.3: Commit**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add hooks/hooks.json
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: add SessionStart hook to hooks.json"
```

---

## Task 7: settings.json — Add SessionStart for manual wiring

**Files:**
- Modify: `C:\Users\NidhinD\.claude\settings.json`

The manual wiring in `settings.json` (used because plugin install via CLI doesn't work with local paths) needs a `SessionStart` entry alongside the existing `PostToolUse` entries.

- [ ] **Step 7.1: Read current settings.json hooks section**

```powershell
(Get-Content "C:\Users\NidhinD\.claude\settings.json" | ConvertFrom-Json).hooks | ConvertTo-Json -Depth 5
```

- [ ] **Step 7.2: Add SessionStart hook via update-config skill**

Use the `update-config` skill with this instruction:

> Add a SessionStart hook to global settings.json. Matcher: "startup". Command: `powershell -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File "C:\Users\NidhinD\.claude\skills\global-skills\hooks\scripts\start-viewer.ps1"`. Timeout: 30.

- [ ] **Step 7.3: Verify settings.json has both hooks**

```powershell
(Get-Content "C:\Users\NidhinD\.claude\settings.json" | ConvertFrom-Json).hooks | ConvertTo-Json -Depth 5
```

Expected: `PostToolUse` entries (existing) AND `SessionStart` entry (new).

---

## Task 8: GitHub publishing files

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Rewrite: `README.md`
- Create: `LICENSE`
- Create: `CHANGELOG.md`
- Create: `.gitignore`

- [ ] **Step 8.1: Read current plugin.json**

```powershell
Get-Content "C:\Users\NidhinD\.claude\skills\global-skills\.claude-plugin\plugin.json"
```

- [ ] **Step 8.2: Write updated plugin.json**

Write `.claude-plugin/plugin.json`:

```json
{
  "name": "global-skills",
  "version": "1.1.0",
  "description": "Auto-syncs docs/skills.md entries to a global cross-project skills log. Includes a local web viewer on port 38888 with full-text search.",
  "author": {
    "name": "Nidhin Dileepkumar",
    "email": "nidhin.dileepkumar@pbclinear.com"
  },
  "homepage": "https://github.com/NidhinD/global-skills",
  "repository": {
    "type": "git",
    "url": "https://github.com/NidhinD/global-skills.git"
  },
  "license": "MIT",
  "keywords": ["skills", "knowledge", "institutional-memory", "developer-tools", "claude-code"]
}
```

- [ ] **Step 8.3: Write LICENSE**

Write `LICENSE`:

```
MIT License

Copyright (c) 2026 Nidhin Dileepkumar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 8.4: Write CHANGELOG.md**

Write `CHANGELOG.md`:

```markdown
# Changelog

## [1.1.0] — 2026-06-10

### Added
- Local web viewer on port 38888 (3-column split-pane UI)
- SQLite/FTS5 search index at `~/.claude/global-skills.db`
- `SessionStart` hook to auto-start viewer on session begin
- `start-viewer.ps1` hook script with auto-npm-install on first run
- MIT license, public README for GitHub publishing

### Changed
- `hooks/hooks.json` now includes `SessionStart` alongside `PostToolUse`

## [1.0.0] — 2026-06-05

### Added
- `PostToolUse` hook syncs `docs/skills.md` entries to `~/.claude/global-skills.md`
- `/gskills` skill for searching the global log
- Deduplication via `<!-- project -->` markers in header lines
```

- [ ] **Step 8.5: Write .gitignore**

Write `.gitignore`:

```gitignore
viewer/node_modules/
*.db
*.log
*.pid
.env
```

- [ ] **Step 8.6: Write README.md**

Write `README.md`:

```markdown
# global-skills — Claude Code Plugin

Automatically syncs skill entries from any project's `docs/skills.md` to a central `~/.claude/global-skills.md` log, with cross-project attribution. Includes a local web viewer for searching and browsing your institutional knowledge base.

## What it does

- **PostToolUse hook** — fires after every `Write` or `Edit` to any `docs/skills.md`. Extracts `## [YYYY-MM-DD]` entries and appends them to `~/.claude/global-skills.md` with a `**Project:** name` attribution line.
- **Web viewer** — starts at session begin on `http://localhost:38888`. 3-column split-pane UI (projects | entries | detail). Full-text search powered by SQLite FTS5.
- **`/gskills` skill** — search the global log from within Claude Code.

## Install

```bash
claude plugin install github:YOUR_USERNAME/global-skills
```

Then add the `SessionStart` hook to your `~/.claude/settings.json` (see **Manual hook wiring** below).

## Manual hook wiring

The `PostToolUse` hooks run automatically via the plugin system. The `SessionStart` hook for the viewer requires a one-time manual entry in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File \"C:\\Users\\USERNAME\\.claude\\skills\\global-skills\\hooks\\scripts\\start-viewer.ps1\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `USERNAME` with your Windows username.

## Usage

```bash
/gskills                              # 10 most recent entries
/gskills sql server                   # search by keyword
/gskills --project rma_process_automate
/gskills --recent 20
```

Web viewer: open `http://localhost:38888` in any browser after starting a Claude Code session.

## How skill entries are captured

In any project, write entries to `docs/skills.md` using this format:

```markdown
## [YYYY-MM-DD] — Skill Title

**Problem:** What went wrong or what challenge was faced.

**Solution:** What was done to solve it.

**Takeaway:** The reusable lesson.
```

The hook fires automatically and appends the entry to the global log.

## Platform support

- **Windows (PowerShell):** fully supported — hooks and viewer are `.ps1` scripts
- **Mac/Linux:** `sync-skills.ps1` is Windows-only in v1.1.0. Shell script equivalents are welcome as community contributions.

## Files

```
global-skills/
├── viewer/
│   ├── server.js          # Node.js HTTP server (port 38888)
│   ├── package.json       # better-sqlite3 dependency
│   └── public/
│       └── index.html     # 3-column viewer UI
├── hooks/
│   ├── hooks.json
│   └── scripts/
│       ├── sync-skills.ps1    # PostToolUse: MD sync
│       └── start-viewer.ps1   # SessionStart: viewer startup
├── skills/
│   └── gskills/
│       └── SKILL.md       # /gskills command
├── .claude-plugin/
│   └── plugin.json
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 8.7: Commit all publishing files**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add .claude-plugin/plugin.json LICENSE CHANGELOG.md .gitignore README.md
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "feat: GitHub publishing prep — v1.1.0 plugin.json, README, LICENSE, CHANGELOG"
```

---

## Task 9: Deploy to ~/.claude/skills/global-skills/

**Files:** Copy all changed/new files from project dir to deploy target.

- [ ] **Step 9.1: Copy new files to deploy target**

```powershell
$src = "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin"
$dst = "C:\Users\NidhinD\.claude\skills\global-skills"

# New viewer files
Copy-Item "$src\viewer" "$dst\viewer" -Recurse -Force
# Exclude node_modules if it was created during testing
Remove-Item "$dst\viewer\node_modules" -Recurse -Force -ErrorAction SilentlyContinue

# New hook script
Copy-Item "$src\hooks\scripts\start-viewer.ps1" "$dst\hooks\scripts\start-viewer.ps1" -Force

# Updated hooks.json
Copy-Item "$src\hooks\hooks.json" "$dst\hooks\hooks.json" -Force

# Publishing files
Copy-Item "$src\.claude-plugin\plugin.json" "$dst\.claude-plugin\plugin.json" -Force
Copy-Item "$src\README.md"     "$dst\README.md"     -Force
Copy-Item "$src\LICENSE"       "$dst\LICENSE"       -Force
Copy-Item "$src\CHANGELOG.md"  "$dst\CHANGELOG.md"  -Force
Copy-Item "$src\.gitignore"    "$dst\.gitignore"    -Force

Write-Host "Deploy complete"
```

- [ ] **Step 9.2: Verify deploy target structure**

```powershell
Get-ChildItem "C:\Users\NidhinD\.claude\skills\global-skills" -Recurse | Select-Object FullName
```

Expected: see `viewer/server.js`, `viewer/public/index.html`, `viewer/package.json`, `hooks/scripts/start-viewer.ps1`, updated `hooks/hooks.json`.

---

## Task 10: End-to-end test

- [ ] **Step 10.1: Test start-viewer.ps1 from deploy target**

```powershell
$ps1 = "C:\Users\NidhinD\.claude\skills\global-skills\hooks\scripts\start-viewer.ps1"
powershell -ExecutionPolicy Bypass -NonInteractive -File $ps1
Start-Sleep 5   # allow npm install + server start
```

- [ ] **Step 10.2: Verify npm install ran in viewer/**

```powershell
Test-Path "C:\Users\NidhinD\.claude\skills\global-skills\viewer\node_modules\better-sqlite3"
# Expected: True
```

- [ ] **Step 10.3: Verify server is running**

```powershell
Invoke-RestMethod "http://localhost:38888/api/skills" | Measure-Object | Select-Object Count
# Expected: Count = N (number of skills in global-skills.md)
```

- [ ] **Step 10.4: Open viewer in browser and smoke-test**

```powershell
Start-Process "http://localhost:38888"
```

Verify:
1. Projects list populates
2. Clicking a project filters entries
3. Clicking an entry shows Problem/Solution/Takeaway
4. Search box returns results (try "sql", "ejs", "bcrypt")

- [ ] **Step 10.5: Verify SessionStart hook fires in new session**

Close Claude Code and reopen it. After session starts, run:

```powershell
netstat -ano | Select-String ":38888"
```

Expected: a line showing `LISTENING` on port 38888 — viewer started automatically.

- [ ] **Step 10.6: Update docs/PLAN.md outcome**

Append to the plan entry in `docs/PLAN.md`:

```markdown
### Outcome

All tasks complete. Viewer running at http://localhost:38888 with SQLite FTS5 search.
SessionStart hook auto-starts viewer on session begin. Plugin files deployed to
~/.claude/skills/global-skills/. Ready for GitHub publishing.
```

- [ ] **Step 10.7: Update docs/memory.md**

Append session summary to `docs/memory.md`.

- [ ] **Step 10.8: Final commit**

```powershell
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" add docs/
git -C "C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin" commit -m "docs: update PLAN.md and memory.md — v1.1.0 complete"
```

---

## Self-review notes

**Spec coverage check:**
- ✅ viewer/server.js with SQLite schema + MD sync + HTTP API (Tasks 2, 3)
- ✅ viewer/public/index.html 3-column UI with search (Task 4)
- ✅ start-viewer.ps1 with port check + auto-npm-install (Task 5)
- ✅ hooks/hooks.json SessionStart entry (Task 6)
- ✅ settings.json manual wiring (Task 7)
- ✅ plugin.json v1.1.0 + GitHub fields (Task 8)
- ✅ README rewrite, LICENSE, CHANGELOG, .gitignore (Task 8)
- ✅ Deploy step (Task 9)
- ✅ End-to-end test (Task 10)

**Type consistency:**
- `stmtAll`, `stmtByProject`, `stmtSearch`, `stmtSearchProj` defined in Task 3, referenced only in Task 3 — no cross-task name drift.
- `parseMd()`, `extractSection()`, `syncMdToDb()` defined in Task 2, not referenced in later tasks (server startup calls them directly).

**No placeholders:** All code blocks are complete and runnable.
