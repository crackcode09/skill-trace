# Changelog

## [1.3.0] — unreleased

The adoption line: capture (Phase 1) now, in-session context injection (Phase 2) to follow.

### Added
- **`log-lesson` skill** (Phase 1) — captures one genuinely reusable, non-obvious
  lesson per session as a Problem/Solution/Takeaway entry in the project's
  `docs/skills.md`; the existing sync hook then propagates it to the global log.
  Enforces a trigger bar (log only what would waste a competent engineer's time
  next time), a **source-trust gate** (untrusted projects can't author global
  lessons — the capture-side mirror of the Phase 2 injection gate), an
  environment-sourced date, a near-duplicate check, and a controlled `**Stack:**`
  tag vocabulary defined in `docs/FORMAT.md`. See `skills/log-lesson/`.
- **`**Stack:**` entry field + controlled vocabulary** in `docs/FORMAT.md` — the
  relevance key Phase 2 injection will score against. Forward-compatible: the
  current viewer parser ignores it, so entries written now sync cleanly and gain
  meaning when Phase 2 lands.
- **First-run onboarding empty state** in the viewer — an empty log now shows
  "No lessons yet" with the `log-lesson` hint and a format template instead of a
  blank pane. No-match searches and empty project filters keep their terse
  messages (the onboarding shows only when the log is genuinely empty).
- **Configurable source path** — `SKILL_TRACE_SOURCE_PATTERN` (a regex) lets a
  project sync from a file other than `docs/skills.md` (e.g. `LESSONS\.md$`).
  **Backward-compatible: unset = the previous `docs/skills.md` behavior exactly**,
  so existing projects are unaffected.
- **Dashboard view** in the viewer — a "group by Stack tag" overview: one card per
  tag with its lesson count, the latest lesson title, and chips for the projects
  that contributed it. Click a card to drill into that tag's lessons. Zero-dep
  (CSS cards, no chart library). The parser now surfaces `**Stack:**` tags via the
  API (`stack[]` on each entry), and search matches stack tags too. A `demo/`
  fixture of fictional stack-tagged lessons ships for showcasing it.

### Fixed
- **Leading UTF-8 BOM no longer zeroes a file.** An externally-edited
  `docs/skills.md` (or the global log) carrying a BOM prefixed the first `## `
  header, so it matched no entries and parsed to zero. The sync hooks (PowerShell
  + Python) and the viewer parser now strip a leading BOM. Regression test added.

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
- **Registry dir parity**: the PowerShell source-recorder didn't create `~/.claude`
  before writing (the Python path did via `makedirs`). Added the guard. A new
  **runtime** hook test spawns the real per-OS script and asserts the full chain
  (record → parse → append), the coverage that parse-only checks miss.
- **Global-log append race**: the global-log append path is now guarded by the
  same sync-wide lock the trust registry uses, on both Windows and POSIX. Two
  sessions writing the same `docs/skills.md` concurrently can no longer append a
  duplicate entry. (Previously a known issue; content-hash dedup was the only
  backstop. A concurrent-fire test now reproduces the race and confirms the fix.)
- **Viewer favicon 404**: every page load logged a `GET /favicon.ico 404`
  console error. Added an inline SVG `<link rel="icon">` to the viewer head,
  reusing the existing brand `trace` glyph — zero new files, no server route.

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
