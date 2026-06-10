'use strict';

const { createServer } = require('http');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const HOME      = homedir();
const MD_PATH   = join(HOME, '.claude', 'global-skills.md');
const PORT      = parseInt(process.env.GLOBAL_SKILLS_PORT || '38888', 10);
const HTML_PATH = join(__dirname, 'public', 'index.html');

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
    entries.push({
      id:       entries.length + 1,
      title:    rawTitle.trim(),
      date,
      project:  project.trim(),
      problem:  extractSection(block.split('\n').slice(1).join('\n'), 'Problem'),
      solution: extractSection(block.split('\n').slice(1).join('\n'), 'Solution'),
      takeaway: extractSection(block.split('\n').slice(1).join('\n'), 'Takeaway'),
      raw:      block.trim(),
    });
  }
  return entries;
}

// ── Load entries ──────────────────────────────────────────────────────────────

let entries = [];
if (existsSync(MD_PATH)) {
  entries = parseMd(readFileSync(MD_PATH, 'utf8'));
  console.log(`[global-skills] loaded ${entries.length} entries from ${MD_PATH}`);
} else {
  console.log(`[global-skills] ${MD_PATH} not found — starting with empty entries`);
}

// ── Search ────────────────────────────────────────────────────────────────────

function search(q, project) {
  let results = entries;
  if (project) {
    results = results.filter(e => e.project === project);
  }
  if (q) {
    const lq = q.toLowerCase();
    results = results.filter(e =>
      (e.title    || '').toLowerCase().includes(lq) ||
      (e.problem  || '').toLowerCase().includes(lq) ||
      (e.solution || '').toLowerCase().includes(lq) ||
      (e.takeaway || '').toLowerCase().includes(lq) ||
      (e.project  || '').toLowerCase().includes(lq)
    );
  }
  return results;
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

  if (url.pathname === '/api/skills') {
    const q       = url.searchParams.get('q') || '';
    const project = url.searchParams.get('project') || '';
    const rows    = search(q, project);
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
