# Global Skills Viewer — Design Spec
**Date:** 2026-06-10
**Status:** Approved

---

## Overview

Add a local web viewer to the `global-skills` Claude Code plugin. The viewer runs on port 38888 and displays entries in a searchable 3-column split-pane UI. It starts automatically on session start via a `SessionStart` hook. The viewer lives entirely inside the plugin directory — no separate project.

**Storage model:** `global-skills.md` remains the canonical source (hook writes to it, human-readable). `global-skills.db` (SQLite with FTS5) is the search index, owned and maintained by the viewer server. On startup the server parses the MD file and upserts any new entries into the DB. Hook is unchanged.

Simultaneously, clean up the plugin for public GitHub publishing so others can install it.

---

## Architecture

### Plugin directory after changes

```
~/.claude/skills/global-skills/
├── viewer/
│   ├── server.js               # Node.js HTTP server (http, fs, path, os, better-sqlite3)
│   ├── package.json            # NEW — { "better-sqlite3": "^9.x" }
│   ├── node_modules/           # gitignored — created by npm install on first run
│   └── public/
│       └── index.html          # 3-column UI — vanilla JS, inline CSS, no dependencies
├── hooks/
│   ├── hooks.json              # Add SessionStart entry
│   └── scripts/
│       ├── sync-skills.ps1     # Existing — unchanged
│       └── start-viewer.ps1    # NEW — starts viewer in background
├── skills/
│   └── gskills/
│       └── SKILL.md            # Existing — unchanged
├── .claude-plugin/
│   └── plugin.json             # Bump to v1.1.0, add GitHub fields
├── LICENSE                     # NEW — MIT
├── CHANGELOG.md                # NEW
├── .gitignore                  # NEW
└── README.md                   # Rewrite for public audience
```

### Session flow

1. Claude Code session starts → `SessionStart` hook fires → `start-viewer.ps1` runs
2. Script checks if port 38888 already in use (`netstat`); skips silently if occupied
3. If `viewer/node_modules/` missing → runs `npm install` in `viewer/` first (one-time)
4. Launches `node viewer/server.js` in background via `Start-Process -WindowStyle Hidden`
5. Server starts, logs: `[global-skills] viewer running at http://localhost:38888`
6. User visits `http://localhost:38888` any time during session

### SQLite schema (`~/.claude/global-skills.db`)

```sql
CREATE TABLE IF NOT EXISTS skills (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT NOT NULL,
  date      TEXT NOT NULL,       -- YYYY-MM-DD
  project   TEXT NOT NULL,
  problem   TEXT,
  solution  TEXT,
  takeaway  TEXT,
  raw       TEXT NOT NULL,       -- full original markdown block
  synced_at TEXT NOT NULL        -- ISO 8601 UTC, set at insert time
);

CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  title, project, problem, solution, takeaway,
  content=skills, content_rowid=id
);
```

**Server startup sync:**

1. Open (or create) `~/.claude/global-skills.db`
2. Parse `~/.claude/global-skills.md` into entry blocks
3. For each entry: check if `title + project` already in DB; insert if missing
4. FTS index auto-updates via FTS5 content table triggers

### API (server.js)

Two endpoints only:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves `public/index.html` |
| `GET` | `/api/skills` | Queries SQLite. Accepts `?project=X` and `?q=searchterm` (FTS5 for `?q`) |

**JSON entry shape:**

```json
{
  "id": 3,
  "title": "Named SQL Server Instance Connection",
  "date": "2026-06-05",
  "project": "rma_process_automate",
  "problem": "SQL Server PBC-SW\\Sparkflow is a named instance...",
  "solution": "Use options: { instanceName: 'Sparkflow' }...",
  "takeaway": "Named SQL Server instances require instanceName...",
  "raw": "## [2026-06-05] — Named SQL Server... (full block text)"
}
```

**Query logic:**

- No `?q` → `SELECT * FROM skills ORDER BY date DESC`
- With `?q` → `SELECT skills.* FROM skills_fts JOIN skills ON skills.id = skills_fts.rowid WHERE skills_fts MATCH ? ORDER BY rank`
- With `?project` → add `WHERE project = ?` to either query

---

## UI (index.html)

### Layout

3-column flexbox, full viewport height, dark theme.

```
┌─────────────────────────────────────────────────────────────────┐
│  🎓 Global Skills Log              [🔍 Search entries...      ] │
├──────────────────┬───────────────────┬──────────────────────────┤
│ PROJECTS         │ ENTRIES           │ DETAIL                   │
│                  │                   │                          │
│ ● All (12)       │ Named SQL Server  │ ## Named SQL Server...   │
│   rma_auto (7)   │ EJS Layout        │ Project: rma_auto        │
│   dispatch (5)   │ SRI Hash          │ Date: 2026-06-05         │
│                  │ ▶ bcrypt ESM      │                          │
│                  │                   │ Problem:                 │
│                  │                   │ Named instance not on    │
│                  │                   │ port 1433...             │
│                  │                   │                          │
│                  │                   │ Solution:                │
│                  │                   │ Use instanceName...      │
│                  │                   │                          │
│                  │                   │ Takeaway:                │
│                  │                   │ SQL Browser must run     │
├──────────────────┴───────────────────┴──────────────────────────┤
│  http://localhost:38888 · global-skills v1.1.0 · 12 entries     │
└─────────────────────────────────────────────────────────────────┘
```

### Behaviour

- **Search bar**: live search hits `/api/skills?q=` — uses FTS5 on server, results replace entry list
- **Project click**: calls `/api/skills?project=X`; "All" calls `/api/skills` unfiltered
- **Entry click**: loads full entry into detail panel; highlights selected row
- **Detail rendering**: light markdown — `**bold**` → `<strong>`, `` `code` `` → `<code>`, `\n\n` → paragraph breaks. No full markdown parser.
- **Empty state**: detail panel shows "Select an entry" placeholder until first click
- **Footer**: URL · version · entry count

---

## hooks/hooks.json changes

Add `SessionStart` alongside existing `PostToolUse` entries:

```json
{
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

`$CLAUDE_PLUGIN_ROOT` resolves for marketplace-installed plugins. For manual `settings.json` wiring (direct install), use the absolute path:

```json
"command": "powershell -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File \"C:\\Users\\USERNAME\\.claude\\skills\\global-skills\\hooks\\scripts\\start-viewer.ps1\""
```

Timeout set to 30s to allow `npm install` on first run.

---

## start-viewer.ps1

```powershell
# Starts the global-skills viewer in background on port 38888.
# Runs npm install on first use. Skips if port already occupied.
param()

$port     = 38888
$inUse    = netstat -ano | Select-String ":$port "
if ($inUse) { exit 0 }

$script_dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer_dir  = [System.IO.Path]::GetFullPath((Join-Path $script_dir "..\..\viewer"))
$server      = Join-Path $viewer_dir "server.js"
$node_mods   = Join-Path $viewer_dir "node_modules"

if (-not (Test-Path $server)) { exit 0 }

# One-time npm install
if (-not (Test-Path $node_mods)) {
    Push-Location $viewer_dir
    npm install --silent 2>$null
    Pop-Location
}

Start-Process "node" -ArgumentList "`"$server`"" -WindowStyle Hidden
exit 0
```

---

## GitHub Publishing Changes

### plugin.json — v1.1.0

Add `homepage`, `repository`, `license`. Remove PBC-specific `keywords`. Description becomes generic.

### README.md

Full rewrite:

- What it does (generic, no PBC branding)
- Install: `claude plugin install github:USERNAME/global-skills`
- SessionStart hook wiring (copy-paste block for manual install)
- Usage: `/gskills`, viewer at `http://localhost:38888`
- Platform note: hook scripts are Windows (PowerShell); Mac/Linux shell equivalent noted as community contribution welcome

### New files

| File | Content |
|------|---------|
| `LICENSE` | MIT, copyright Nidhin Dileepkumar |
| `CHANGELOG.md` | v1.0.0 (sync hook + /gskills), v1.1.0 (viewer + SQLite added) |
| `.gitignore` | `*.pid`, `viewer/node_modules/`, `*.log`, `*.db` |

---

## Development workflow (this project)

Code developed in: `C:\Users\NidhinD\OneDrive - PBC Linear\Documents\nidhin.dev\global-skills-plugin\`

Deploy target: `C:\Users\NidhinD\.claude\skills\global-skills\`

After testing, copy changed files to deploy target. Never edit the deploy target directly.

---

## Out of Scope

- Live reload when `global-skills.md` changes (manual browser refresh is fine)
- Mac/Linux `SessionStart` shell script (Windows-only for v1.1.0; community can add)
- Authentication or access control (localhost-only, dev tool)
- Persisting viewer state between sessions
- SSE streaming (static fetch on page load is sufficient)
