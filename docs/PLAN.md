# PLAN.md — global-skills-plugin

---

## [2026-06-10] — Plan: global-skills v1.1.0 — Viewer + SQLite + GitHub publish

### Status: COMPLETE

### What is being built or changed

Add a local web viewer (port 38888) to the global-skills Claude Code plugin. Add SQLite/FTS5 as a search index. Prep the plugin for public GitHub publishing.

### Files to be created or modified

**New files (in `~/.claude/skills/global-skills/`):**
- `viewer/server.js` — Node.js HTTP server, starts on SessionStart
- `viewer/package.json` — better-sqlite3 dependency
- `viewer/public/index.html` — 3-column split-pane UI (vanilla JS, dark theme)
- `hooks/scripts/start-viewer.ps1` — SessionStart hook script
- `LICENSE` — MIT
- `CHANGELOG.md` — version history
- `.gitignore` — excludes node_modules, db, logs

**Modified files:**
- `hooks/hooks.json` — add SessionStart entry
- `.claude-plugin/plugin.json` — bump to v1.1.0, add GitHub fields
- `README.md` — full rewrite for public audience

**Storage:**
- `~/.claude/global-skills.db` — SQLite DB created at runtime by viewer server

### Implementation steps

1. Create `viewer/package.json`
2. Create `viewer/server.js` — HTTP server with startup MD→SQLite sync and two API endpoints
3. Create `viewer/public/index.html` — 3-column UI with live search via FTS5
4. Create `hooks/scripts/start-viewer.ps1` — port check + npm install + Start-Process
5. Update `hooks/hooks.json` — add SessionStart entry
6. Update `settings.json` — add SessionStart hook for manual install path
7. Update `.claude-plugin/plugin.json` — v1.1.0 + GitHub fields
8. Rewrite `README.md` — generic, install instructions, usage
9. Add `LICENSE`, `CHANGELOG.md`, `.gitignore`
10. Test: start fresh session, verify viewer starts, verify search works
11. Copy files to deploy target: `~/.claude/skills/global-skills/`

### Assumptions & decisions

- `global-skills.md` stays as canonical source; SQLite is an index rebuilt from it
- Fixed port 38888 (single-user dev machine)
- Windows-only for v1.1.0 (PowerShell hooks); Mac/Linux noted as community contribution
- `npm install` runs automatically on first viewer start (handled by start-viewer.ps1)
- Timeout for SessionStart hook set to 30s to allow first-run npm install

### Questions for user

None — design fully approved.

### Outcome (filled in after completion)

All 10 tasks complete. Viewer deployed to `~/.claude/skills/global-skills/viewer/`. Server starts on port 38888 via SessionStart hook. SQLite FTS5 search verified (3 entries, search + project filter working). Homepage serves 3-column dark UI. Binary workaround (copy `better_sqlite3.node` from RMA project) documented in `start-viewer.ps1`. GitHub publishing files in place (plugin.json v1.1.0, README, LICENSE, CHANGELOG).

**Known issue:** RMA `docs/skills.md` uses `## YYYY-MM-DD —` format (no brackets); sync-skills.ps1 expects `## [YYYY-MM-DD] —`. Entries added manually to `global-skills.md` in correct format for now. Format unification is a follow-up task.

---

## [2026-06-10] — Plan: Edge Case Fixes (7 issues)

### Status: COMPLETE

### What is being built or changed
Fix 7 identified edge cases in the global-skills viewer plugin.

### Files to be created or modified
- `viewer/server.js` — fixes: #1 format mismatch (parseMd regex), #2 DB stale (fs.watch), #5 FTS5 special chars (query sanitize), #6 pagination (?limit/offset)
- `hooks/scripts/sync-skills.ps1` — fix #1 format mismatch (accept both `## [YYYY-MM-DD]` and `## YYYY-MM-DD`)
- `hooks/scripts/start-viewer.ps1` — fixes: #3 hardcoded binary path (dynamic scan), #4 port conflict (probe /api/skills), #7 race condition (PID file)
- Both source project AND deployed `~/.claude/skills/global-skills/` copies updated

### Implementation steps
1. Fix sync-skills.ps1: accept both date formats in line 36 early-exit and line 60 block-split
2. Fix server.js parseMd: accept both `## [YYYY-MM-DD]` and `## YYYY-MM-DD` formats
3. Fix server.js: add `fs.watch` with 500ms debounce for live MD→DB sync
4. Fix server.js: sanitize FTS5 query — escape/strip `"():-*^` chars, fallback to LIKE
5. Fix server.js: add ?limit/offset to /api/skills; default limit=100
6. Fix start-viewer.ps1: scan for binary dynamically instead of hardcoded RMA path
7. Fix start-viewer.ps1: write PID file, probe port with HTTP before skipping
8. Deploy all changed files to ~/.claude/skills/global-skills/

### Assumptions & decisions
- Keep RMA docs/skills.md in its current format — sync script adapts to it
- Normalize both formats to bracketed `[YYYY-MM-DD]` in server.js for DB consistency
- PID file at `~/.claude/global-skills.pid`
- Binary scan: search `$env:USERPROFILE` recursively, cap depth to 6 levels

### Outcome

All 7 edge cases fixed. Files modified: viewer/server.js, hooks/scripts/sync-skills.ps1, hooks/scripts/start-viewer.ps1, viewer/public/index.html. Both source project and deployed ~/.claude/skills/global-skills/ are in sync (same directory).

---

## [2026-06-10] — Plan: UI Polish + Brand Rename + Documentation

### Status: COMPLETE

### What is being built or changed

- Redesign viewer UI to match Canary Mail 3-column density pattern
- Rename brand from "Global Skills Log" to skill-trace
- Replace logo with trace-path SVG icon
- Create technical documentation (docs/project.md) and development poster (docs/poster.html)

### Files to be created or modified

- `viewer/public/index.html` — CSS redesign (projects, entries, detail), brand rename, new logo
- `docs/project.md` — new: full technical reference
- `docs/poster.html` — new: visual development story poster

### Implementation steps

1. Fix detail panel: `flex: 1` + `max-width: 100%` (Canary Mail fill pattern)
2. Redesign projects column: dot indicators, accent-dim active state
3. Redesign entries column: title+date same row, project tag below
4. Rename brand to skill-trace; replace logo with trace-path SVG
5. Create docs/project.md (architecture, API, schema, edge cases, roadmap)
6. Create docs/poster.html (6-section dark HTML poster)

### Assumptions & decisions

- Canary Mail reference: detail pane fills all remaining space, no inner max-width centering
- skill-trace chosen over alternatives (claude-mem, skill-log) — CLI-native feel

### Outcome

All steps complete. Detail panel fills screen edge-to-edge. Projects column has blue-tinted active state with dot indicators. Entry rows match Canary Mail pattern (title+date top row, tag below). Brand is skill-trace with trace-path SVG logo. docs/project.md and docs/poster.html created.

---

## [2026-06-10] — Plan: node-sqlite3-wasm Migration (Mac Support)

### Status: PENDING

### What is being built or changed

Replace `better-sqlite3` (requires native compilation) with `node-sqlite3-wasm` (pure JS, no native binary needed). Prerequisite for Mac/Linux support and marketplace publish.

### Files to be created or modified

- `viewer/server.js` — swap DB layer (import + API calls)
- `viewer/package.json` — replace `better-sqlite3` with `node-sqlite3-wasm`
- `hooks/scripts/start-viewer.ps1` — remove binary copy logic (no longer needed)
- `hooks/scripts/start-viewer.sh` — new: Mac/Linux bash equivalent
- `hooks/hooks.json` — add bash SessionStart entry

### Implementation steps

1. Install node-sqlite3-wasm in viewer/
2. Rewrite viewer/server.js DB layer (FTS5 + LIKE fallback — API surface unchanged)
3. Update viewer/package.json
4. Remove binary copy logic from start-viewer.ps1
5. Write start-viewer.sh (port check via lsof, HTTP probe, nohup launch)
6. Add bash hook entry to hooks/hooks.json
7. Test Windows (verify no regression)
8. Test Mac (or document for community validation)
9. Push to GitHub

### Questions for user

- None — design doc approved (Approach A)
