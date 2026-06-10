# skill-trace — Project Documentation

> Local web viewer for accumulated skill entries across all Claude Code projects.
> Auto-starts on session begin. Full-text search via SQLite FTS5.

**Developer:** Nidhin Dileepkumar (`nidhin.dileepkumar@pbclinear.com`)
**Version:** v1.1.0
**Port:** `38888` (fixed, single-user dev machine)
**Entry point:** `viewer/server.js`

---

## What It Does

Claude Code developers accumulate lessons learned across projects in `docs/skills.md` files.
Those entries stay siloed — invisible when starting a new project, inaccessible when facing
a problem already solved elsewhere.

**skill-trace** solves this by:
- Aggregating all `docs/skills.md` entries into a single `~/.claude/global-skills.md`
- Syncing that file into a SQLite FTS5 search index on session start
- Serving a 3-column dark viewer on `http://localhost:38888` that launches automatically

---

## Architecture

```
Claude Code session starts
        │
        ▼
SessionStart hook → start-viewer.ps1
        │
        ├── Port 38888 already serving? → skip
        │
        └── Start: node viewer/server.js
                │
                ├── Parse ~/.claude/global-skills.md → SQLite FTS5 DB
                ├── fs.watch → auto-resync on file changes (500ms debounce)
                ├── Write PID → ~/.claude/global-skills.pid
                └── Serve on :38888
                        │
                        ├── GET /              → viewer/public/index.html
                        ├── GET /api/skills    → JSON skill entries (FTS5 + LIKE fallback)
                        └── POST /api/sync     → manual re-parse trigger

PostToolUse hook → sync-skills.ps1
        │
        └── On Write to docs/skills.md → append new entries to global-skills.md
```

### Data Flow (A2 Pattern)

```
~/.claude/global-skills.md   ← canonical source (flat markdown)
        │
        ▼ parseMd() on startup + fs.watch
~/.claude/global-skills.db   ← SQLite FTS5 index (search-only, rebuilt from MD)
        │
        ▼ /api/skills
viewer/public/index.html      ← 3-column dark UI (vanilla JS, no framework)
```

**Rule:** `global-skills.md` is the source of truth. The DB is a cache — always rebuildable.

---

## Directory Structure

```
global-skills-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (v1.1.0)
├── hooks/
│   ├── hooks.json               # SessionStart + PostToolUse hook declarations
│   └── scripts/
│       ├── start-viewer.ps1     # Windows: port check, npm install, launch server
│       ├── start-viewer.sh      # Mac/Linux: bash equivalent (v1.2 — pending)
│       └── sync-skills.ps1      # PostToolUse: append new skill entries to global-skills.md
├── viewer/
│   ├── server.js                # Node.js HTTP server + SQLite FTS5 sync
│   ├── package.json             # Dependencies: better-sqlite3
│   └── public/
│       └── index.html           # Single-file 3-column dark UI (all CSS + JS inline)
├── docs/
│   ├── PLAN.md                  # Implementation plans (running log)
│   ├── memory.md                # Session summaries (running log)
│   ├── project.md               # This file
│   └── skills.md                # Patterns learned during development
├── CHANGELOG.md
├── LICENSE                      # MIT
├── README.md
└── .gitignore
```

---

## Skill Entry Format

Entries in `docs/skills.md` must follow this format:

```markdown
## [YYYY-MM-DD] — Skill Title <!-- project-name -->

**Problem:** What went wrong or what challenge was faced.

**Solution:** What was done to solve it.

**Takeaway:** The reusable lesson.
```

The `sync-skills.ps1` hook normalizes both `## [YYYY-MM-DD]` and `## YYYY-MM-DD` variants.

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve viewer UI (index.html) |
| `GET` | `/api/skills` | List skill entries. Params: `?q=` (search), `?project=` (filter), `?limit=` (default 100, max 500), `?offset=` |
| `POST` | `/api/sync` | Trigger manual re-parse of global-skills.md → DB |

### /api/skills Response

```json
{
  "skills": [
    {
      "id": 1,
      "title": "EJS Layout Pattern Without Extra Packages",
      "problem": "Standard EJS doesn't support wrapping layout...",
      "solution": "Use <%- include('../layout', { body: ... }) %>...",
      "takeaway": "Avoid express-ejs-layouts — use direct includes...",
      "date": "2026-06-05",
      "project": "rma_process_automate"
    }
  ]
}
```

---

## SQLite Schema

```sql
CREATE VIRTUAL TABLE skills USING fts5(
  title, problem, solution, takeaway, date, project,
  content='', tokenize='porter unicode61'
);

CREATE TABLE skills_data (
  id      INTEGER PRIMARY KEY,
  title   TEXT,
  problem TEXT,
  solution TEXT,
  takeaway TEXT,
  date    TEXT,
  project TEXT
);
```

FTS5 search with porter stemming. Falls back to LIKE search if FTS5 query contains
special characters (`"`, `(`, `)`, `-`, `*`, `^`, `:`).

---

## Environment & Setup

### First-time install

```powershell
# Windows — copy compiled binary from another better-sqlite3 project, then:
cd ~/.claude/skills/global-skills/viewer
npm install --ignore-scripts

# Mac/Linux — pending node-sqlite3-wasm migration (see Open Questions)
```

### Running manually

```powershell
node ~/.claude/skills/global-skills/viewer/server.js
# Viewer at http://localhost:38888
```

### Auto-start (SessionStart hook)

Configured in `~/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [{
      "command": "powershell -ExecutionPolicy Bypass -File \"C:\\Users\\...\\start-viewer.ps1\""
    }]
  }
}
```

---

## Environment Variables

None required. All paths are derived from `$env:USERPROFILE` and `$env:APPDATA`.

---

## Edge Cases Fixed (v1.1.0)

| # | Issue | Fix |
|---|-------|-----|
| 1 | MD format mismatch — RMA uses `## YYYY-MM-DD`, parser expected `## [YYYY-MM-DD]` | Regex accepts both; normalizes to bracketed on write |
| 2 | DB goes stale after writing new entries | `fs.watch` with 500ms debounce triggers resync |
| 3 | Hardcoded binary path for `better_sqlite3.node` | Dynamic scan of `$USERPROFILE` (depth 6) |
| 4 | Port check had TIME_WAIT race | HTTP probe to `/api/skills` confirms it's our server |
| 5 | FTS5 MATCH silent empty on special chars | Sanitize query + LIKE fallback |
| 6 | No pagination | `?limit` (default 100, max 500) + `?offset` |
| 7 | No process lifecycle tracking | PID file at `~/.claude/global-skills.pid` |

---

## Open Questions (pre-marketplace)

1. **better-sqlite3 on Mac** — No prebuilt binary for Node 22. Recommended fix: migrate
   DB layer to `node-sqlite3-wasm` (pure JS, no native compilation). Prerequisite for
   marketplace publish.

2. **Cross-machine sync** — Two machines = two separate DBs. Deferred to v1.2.

3. **`/gskills` slash command** — Opens viewer URL from Claude Code. Deferred to v1.2.

---

## Roadmap

| Version | Feature |
|---------|---------|
| v1.1.0 | ✅ Viewer + FTS5 + SessionStart hook + 7 edge case fixes + UI polish |
| v1.2.0 | In-session recommendations (PreToolUse hook queries DB, injects top matches into context) |
| v1.2.0 | `/gskills` slash command |
| v2.0.0 | Team sync — shared git repo or hosted API backend |

---

## Security

- No auth — localhost only, single-user dev machine
- No credentials, no external network calls
- SQLite DB at `~/.claude/global-skills.db` — excluded from git
- No user data sent anywhere

---

*Last updated: 2026-06-10*
