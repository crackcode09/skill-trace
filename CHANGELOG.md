# Changelog

## [1.4.0] — unreleased

The store release: one OKF-style file per lesson, typed frontmatter, a single
write path, delete with tombstones, and migration from the single-file log.
Spec: `docs/superpowers/specs/2026-10-02-okf-lesson-store-design.md`.

### Added
- **`viewer/store.js`** — zero-dependency lesson store module (schema 2): ULID ids,
  body hash (hand-edit detection), frontmatter parse/serialize, `createLesson`,
  `upsertGlobal` (dedup by id → hash → same title within 7 days; merges
  provenance; bumps `seen` on recurrence; honours tombstones), `deleteLesson`,
  rollup regeneration (schema-1 `skills.md` / `global-skills.md` for grep
  compatibility + OKF `index.md`), and idempotent `migrateLegacy` that renames —
  never deletes — the old file. CLI: `node viewer/store.js status|create|delete|regen|migrate`.
  **Not yet wired** into the server, hooks or skills; that follows in the next PRs.
- **Viewer reads the lesson store.** `server.js` now loads `~/.claude/skill-trace/lessons`
  instead of parsing `global-skills.md`. On first start a legacy single file is
  migrated automatically (split into lesson files, renamed to `*.legacy-<date>.md`,
  rollup regenerated in place). Until the hooks write to the store directly, entries
  they append to the rollup are absorbed on the next sync. API entries carry `id`
  (ULID), `seen`, `edited` and `meta`. The demo launcher copies the fixture to a temp
  store so `demo/skills-demo.md` stays pristine.
- **Metadata panel** in the entry detail — a collapsible block showing the lesson's
  frontmatter exactly as on disk, with `seen ×N` and an `edited outside the tool`
  flag when the body hash no longer matches.
- **Single write path.** Saving a lesson lands it in the project's own store
  (`.claude/skill-trace/lessons/`, committed with the repo); `docs/skills.md` is
  regenerated as a rollup. It reaches the global store **only if the project is
  trusted** — the registry is now the opt-in gate for sync, not only for future
  injection. `/skill-trust grant` syncs that project's existing lessons at once;
  `revoke` stops future syncs and keeps what was accepted. A locator file
  (`skill-trace-sources.txt`) remembers where each source lives.
- **Hooks shrink to one line.** `sync-skills.ps1` / `.sh` now just pipe the
  Claude Code event to `node store.js hook`; the ~200 lines of duplicated
  PowerShell/Python parsing, locking, registry and dedup logic are gone. One
  implementation, tested once, same behaviour on every platform.
- **`log-lesson` writes via `node store.js create`** (JSON on stdin) and no longer
  refuses to capture in an untrusted project: the lesson stays local and the user
  is told how to grant trust. Lessons carry `generated_by` (`claude-code`,
  `migration`, or `hook` for hand-written entries absorbed from a rollup).
- **Hand edits stay safe.** Entries typed into either rollup are absorbed into the
  store on the next save; a hand-edited lesson file is re-blessed (hash refreshed)
  and, for a trusted project, mirrored globally — the project copy is the author.
- **Delete from the viewer.** A Delete action on the entry detail with an inline
  two-step confirm. `DELETE /api/lessons/:id` removes the file from the global
  store, records a tombstone so a re-sync cannot bring it back, regenerates the
  rollup and resyncs. `GET /api/lessons/:id` returns one lesson.
- **`/skill-trace` command** — `forget <id|title text>` (unique title fragment or
  id; ambiguous fragments are refused with the candidates listed), `sync`, and
  `status` (counts, slug, trusted, hand-edited and recurring lessons).
- **Dashboard cards flag recurrence** — `N recurring` in the card meta when a tag
  has lessons seen more than once.
- **No more `docs/` side effect.** `docs/skills.md` is regenerated only in projects
  that already had one; a new project gets no `docs/` folder. Each project store
  carries a generated `index.md` as its readable summary.
- `viewer/test/store.test.js` — 9 behaviour tests (round-trip, ulid, edited flag,
  upsert semantics, tombstones, migration, rollup parse-back, bad-file skip, paths).

## [1.3.0] — 2026-10-02

The adoption release: capture (`log-lesson`) and the viewer that makes the log worth browsing. In-session context injection is next (v1.4.0). This section also absorbs the unreleased `1.2.1-dev` plumbing (schema marker, trust registry, tests, CI), which never shipped on its own.

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
- **Viewer navigation & search overhaul.**
  - Three-zone top bar: brand (click = Home) left, wide centred search with a live
    `N of M` count inside it, controls right. A `List | Dashboard` segmented control
    replaces the toggle button; refresh is a labelled **Sync** button.
  - **Active-filter strip** under the bar on both views: one removable chip per
    project / Stack filter, plus "Clear all". Drill-downs can be undone from the
    strip, the entries header, `Esc`, or the logo.
  - **Search covers everything you can see**: title, Problem/Solution/Takeaway,
    Stack tags and project slugs. Typing keeps an active Stack filter; the
    dashboard redraws as you type and groups only the lessons in view.
  - Entry detail shows Stack tags as `#tag` badges; click one to drill in.
  - Dashboard grid fills the viewport; below 900px the search takes its own row.
- **`npm run dev` / `npm run demo` / `npm test`** from the repo root (private root
  `package.json`, no dependencies). `demo/run.js` launches a throwaway viewer on the
  fictional demo log at port 38890.
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
- **Consistent paragraph/list rendering in the entry detail.** `renderMd` turned
  every source newline into `<br>`, so hard-wrapped text showed ragged mid-sentence
  breaks and `- ` bullets rendered inline as plain text. Now blank lines separate
  paragraphs, single newlines flow to the container, and a `- ` block becomes a
  real list (folding wrapped continuation lines into each item).
- **Leading UTF-8 BOM no longer zeroes a file.** An externally-edited
  `docs/skills.md` (or the global log) carrying a BOM prefixed the first `## `
  header, so it matched no entries and parsed to zero. The sync hooks (PowerShell
  + Python) and the viewer parser now strip a leading BOM. Regression test added.
- **Sync button never synced**: it called `GET /api/sync`, which the server
  rejects with 405. Now `POST`.
- **Stale detail pane**: after a search removed the selected entry from the list,
  the right pane kept showing it. The first result is selected instead.
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
