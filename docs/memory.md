# memory.md — global-skills-plugin

---

## [2026-06-10] — Session: 7 Edge Case Fixes

### What changed

- Fixed MD format mismatch: sync-skills.ps1 and server.js now accept both `## [YYYY-MM-DD]` and `## YYYY-MM-DD` formats; sync-skills.ps1 normalizes to bracketed on write
- Added fs.watch + 500ms debounce in server.js for live MD→DB sync (no restart needed)
- Added FTS5 query sanitizer + LIKE fallback in server.js (fixes silent empty results on special chars)
- Added `?limit` and `?offset` pagination to /api/skills (default limit 100, max 500)
- Added `/api/sync` HTTP endpoint — triggers manual re-sync
- Fixed hardcoded binary path in start-viewer.ps1: now scans $USERPROFILE recursively (depth 6) for better_sqlite3.node
- Added HTTP probe in start-viewer.ps1: checks /api/skills before deciding port is occupied by our server
- Added PID file at `~/.claude/global-skills.pid` — written on bind, cleaned on exit/SIGTERM
- Added "Refresh" button in UI — calls /api/sync then re-fetches skills list
- RMA docs/skills.md can now sync without manual reformatting

### Files modified / created

- `viewer/server.js` — parseMd regex, fs.watch, sanitizeFts, pagination, /api/sync, PID file
- `hooks/scripts/sync-skills.ps1` — format mismatch regex fix + normalization
- `hooks/scripts/start-viewer.ps1` — dynamic binary scan, HTTP port probe, PID file check
- `viewer/public/index.html` — Refresh button (HTML + CSS + JS)

### Bugs found & fixed

- FTS5 MATCH silently returned empty on queries with `(`, `)`, `-`, `"` — now strips special chars and falls back to LIKE
- netstat port check had TIME_WAIT race — now probes HTTP to confirm it's our server

### Notes

- Binary scan depth capped at 6 to avoid scanning entire USERPROFILE tree too slowly
- `$pid` is still read-only in PS 5.1 — PID file written by Node process (server.js), not PS script

---

## [2026-06-10] — Session: Brainstorming + Design

### What changed

- Brainstormed and designed global-skills v1.1.0 (viewer + SQLite + GitHub publish)
- Design spec written and approved

### Files modified / created

- `docs/superpowers/specs/2026-06-10-global-skills-viewer-design.md` — full design spec
- `docs/PLAN.md` — implementation plan
- `docs/memory.md` — this file

### Bugs found & fixed

None — design phase only.

### Notes

- Layout: 3-column split pane (projects | entries | detail)
- Entry detail: third panel (click entry → detail pane opens right)
- Storage: flat MD as canonical + SQLite FTS5 as search index
- Stack: pure Node.js built-ins + better-sqlite3, no TypeScript, no build step
- Compared to claude-mem architecture — our simpler stack is appropriate (entries are already structured, no AI processing pipeline needed)
- Project home: this directory. Deploy target: `~/.claude/skills/global-skills/`

---

## [2026-06-10] — Session: v1.1.0 Implementation + Deploy

### What changed

- Built viewer component: `viewer/server.js` (SQLite FTS5), `viewer/public/index.html` (3-column dark UI), `viewer/package.json`
- Added `hooks/scripts/start-viewer.ps1` (SessionStart auto-launch)
- Updated `hooks/hooks.json` with SessionStart entry
- Added `SessionStart` to `~/.claude/settings.json` (absolute path for manual install)
- Added GitHub publishing files: `.claude-plugin/plugin.json` (v1.1.0), `README.md`, `LICENSE`, `CHANGELOG.md`, `.gitignore`
- Deployed all files to `~/.claude/skills/global-skills/`
- Verified: server starts on port 38888, FTS5 search works, UI serves 3-column layout

### Files modified / created

- `viewer/server.js` — Node.js HTTP + SQLite FTS5 server
- `viewer/package.json` — better-sqlite3 dependency
- `viewer/public/index.html` — 3-column dark viewer UI
- `hooks/scripts/start-viewer.ps1` — SessionStart hook script
- `hooks/hooks.json` — added SessionStart entry
- `.claude-plugin/plugin.json` — bumped to v1.1.0, added GitHub fields
- `README.md` — full rewrite for public GitHub audience
- `LICENSE` — MIT
- `CHANGELOG.md` — v1.0.0 + v1.1.0 entries
- `.gitignore` — excludes node_modules, db, logs

### Bugs found & fixed

- `better-sqlite3` native compile failure on Node 22.20.0 (no prebuilt binary) → copied compiled `.node` binary from RMA project + `npm install --ignore-scripts`
- `npm install --ignore-scripts` overwrote copied binary → re-copy after install; `start-viewer.ps1` handles this on first run
- `$pid` read-only in PowerShell 5.1 → renamed to `$portPid` in scripts

### Notes

- RMA `docs/skills.md` uses `## YYYY-MM-DD —` format (no brackets); sync-skills.ps1 expects `## [YYYY-MM-DD] —` — follow-up needed to unify formats
- better-sqlite3 binary path: `rma_process_automate\node_modules\better-sqlite3\build\Release\better_sqlite3.node`
- SessionStart hook wired manually in `~/.claude/settings.json` (marketplace `$CLAUDE_PLUGIN_ROOT` path also in hooks.json)

---

## [2026-06-10] — Session: UI Polish + Brand Rename + Documentation

### What changed

- Detail panel CSS: changed from fixed width to `flex: 1` + `max-width: 100%` — content now fills full panel (Canary Mail email-body pattern)
- Projects column redesigned: dot indicators, accent-dim blue active state, 200px fixed width, 34px row height
- Entries column redesigned: Canary Mail layout — title (bold) + date (right-aligned) on same row, project tag below
- Brand renamed from "Global Skills Log" → **skill-trace**
- Logo replaced: lightbulb → trace-path SVG (4 nodes + curve paths, evokes execution traces)
- Status bar + title updated to `skill-trace v1.1.0`
- Created `docs/project.md` — full technical documentation (architecture, API routes, SQLite schema, 7 edge cases table, setup, roadmap)
- Created `docs/poster.html` — dark-themed HTML development story poster (problem/solution, build timeline, tech stack, 5 key decisions, roadmap preview)
- Design doc written by /office-hours at `~/.gstack/projects/unknown/NidhinD-unknown-design-20260610-120822.md` — recommends Approach A (ship v1.1.0 + Mac support)

### Files modified / created

- `viewer/public/index.html` — detail panel CSS, projects column CSS, entries column CSS, brand rename, logo SVG, status bar
- `docs/project.md` — new: full technical reference
- `docs/poster.html` — new: visual development story poster

### Bugs found & fixed

- Fixed width on detail column created visible dead zone to the right — root cause: `width: 560px` on flex child with no siblings to fill remainder. Fix: `flex: 1` with `max-width: 100%`

### Notes

- Canary Mail reference: 3-column layout where detail pane fills all remaining space; content fills panel width; no centering/max-width inside
- Tool naming: CLI-style lowercase hyphenated names (`skill-trace`) punch harder than descriptive names ("Global Skills Log")
- Pending: node-sqlite3-wasm migration (Step 0 before marketplace publish — unblocks Mac users)
- Pending: start-viewer.sh for Mac/Linux (Step 1)
- Design doc needs approval before GitHub push
