# Changelog

## [1.2.1-dev] — unreleased

Foundations for the v1.3.0 adoption work. **No context-injection feature here** —
that lands under the 1.3.0 tag when its code does. This release is plumbing only.

### Added
- **Schema versioning** — file-level `<!-- skill-trace-schema: 1 -->` marker;
  parser treats a missing marker as v1 and warns (never crashes) on a newer one.
  Per-entry override reserved for v2+ in the spec. See `docs/FORMAT.md`.
- **Trust registry** (`~/.claude/skill-trace-trust.txt`) — sources are auto-recorded
  as `trusted=no` by the sync hooks; injection (future) is default-deny per source.
  Capture stays ungated. `/skill-trust` command + `viewer/trust.js` CLI grant/revoke
  with an audit trail (`granted-at` / `granted-by`). See `docs/TRUST.md`.
- **Test harness** — `npm test` (zero deps, `node:test`): parser, dedup/rename,
  merged provenance, schema marker, trust attack-simulation, per-OS script syntax.
- **CI** — GitHub Actions matrix on ubuntu + windows + macos.

### Fixed
- **Windows PowerShell 5.1 parse failure** in `sync-skills.ps1`: a `@{ }` hashtable
  used as a method-call argument swallowed `-replace`'s comma, so the entire
  provenance-merge path was dead on Windows. Wrapped the operator in parens. This
  shipped undetected because the fix was only ever verified on bash/macOS — the CI
  matrix now parses each platform's script on that platform.

### Changed
- `server.js` and `trust.js` export their pure functions and only start a process
  when run directly (`require.main`), enabling tests and the Phase 2 injection seam
  (`trustedSlugs()`). Both honor env-var path overrides for testing.

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
