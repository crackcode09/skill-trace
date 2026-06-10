# skills.md — global-skills-plugin

---

## [2026-06-10] — Canary Mail Pattern for 3-Column Detail Pane

**Problem:** Detail panel had dead space on the right — content was constrained to a fixed width (`560px`) inside a flex child, leaving an empty column artifact visible to the user.

**Solution:** Set `.col-detail { flex: 1; }` with `.detail-inner { max-width: 100%; margin: 0; }`. The flex child fills all remaining space; content fills the panel fully. No fixed width on the outer column.

**Takeaway:** In a 3-column layout, the rightmost column should always be `flex: 1` to consume remaining space. Fixed widths on flex children leave visible dead zones. Only constrain content width inside the panel (via inner div), never on the panel itself.

---

## [2026-06-10] — Tool Naming vs. Descriptive Naming

**Problem:** "Global Skills Log" is descriptive but feels corporate and flat — doesn't communicate the nature of the tool.

**Solution:** Renamed to `skill-trace` — short, lowercase, hyphenated, CLI-native. Like `git-log`, `claude-mem`, `npm-run`.

**Takeaway:** Internal tools for developers benefit from CLI-style naming conventions (lowercase, hyphenated, verb/noun or noun/noun). Short hyphenated names punch harder than descriptive noun phrases. The name should evoke what the tool does, not document it.

---

## [2026-06-10] — Entry Row Layout: Title + Date Same Row (Canary Mail Pattern)

**Problem:** Entry list rows had title and date on separate rows, wasting vertical space and making it harder to scan.

**Solution:** Used flexbox with `justify-content: space-between` for a `.entry-header-row` div — title (`flex: 1`, bold, 2-line clamp) + date (right-aligned, tabular numbers, flex-shrink: 0). Project tag placed below as a separate line, only visible in "All Projects" view.

**Takeaway:** For list UIs, title and date on the same row (space-between) is the information-dense standard. It's the pattern used in email clients (Canary Mail, Apple Mail), git log views, and Slack. Reserve secondary meta (tag, author) for a second line only when it adds information the user needs to scan.

---

## [2026-06-10] — Development Poster as Dual-Purpose Artifact

**Problem:** After building a tool, the reasoning behind architectural decisions (why FTS5, why flat MD as source of truth, why fixed port) lives only in the builder's head — not in git history, not in README.

**Solution:** Created a dark-themed HTML poster (`docs/poster.html`) alongside `docs/project.md`. Poster covers: problem/solution, architecture diagram, 4-phase build timeline, tech stack grid, 5 numbered key decisions with rationale, and roadmap.

**Takeaway:** A development poster serves two audiences simultaneously: external (what was built, why it matters — for stakeholders and community) and internal (decision rationale that doesn't survive in git history — for future maintainers). Writing "Key Decisions" forces explicit articulation of intuitive choices. Self-contained HTML with inline CSS means it opens anywhere, no build step.
