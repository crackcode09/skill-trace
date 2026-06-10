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
