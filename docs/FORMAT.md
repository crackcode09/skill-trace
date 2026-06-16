# skill-trace File Format Spec

The source of truth is flat markdown. This document defines its on-disk format so
parsers, sync scripts, and future versions stay coherent. **Markdown is canonical
at any scale** — the viewer and any future index are derived and disposable.

## Files

- **Per-project:** `docs/skills.md` — what a human or Claude writes.
- **Global:** `~/.claude/global-skills.md` — sync target, aggregates every project.

Both use the same entry format.

## Entry format

```markdown
## [YYYY-MM-DD] — Short title <!-- project-slug -->

**Stack:** node, concurrency, locking

**Problem:** What went wrong or what challenge was faced.

**Solution:** What was done to solve it.

**Takeaway:** The reusable lesson.
```

Rules:

- Header: `## [YYYY-MM-DD] — Title`. Bare `## YYYY-MM-DD` (no brackets) is accepted
  on input and normalized to bracketed form on sync.
- The trailing HTML comment on the **header line** is **provenance** — a
  comma-separated list of source project slugs: `<!-- proj-a, proj-b -->`. Written
  and merged by the sync scripts; never hand-edited as a rule.
- `**Stack:**` (see below) is the first body line when present. `**Problem:** /
  **Solution:** / **Takeaway:**` are the remaining body sections. All optional
  individually; the parser renders whatever it recognizes.

## Stack tags (controlled vocabulary)

`**Stack:**` is a comma-separated, lowercase list of tags naming the technologies
and concepts a lesson is about. It is the **relevance key** Phase 2 injection will
score against (file-extension → tag mapping), so the vocabulary is controlled — it
grows by deliberate addition, never by typo.

**Authoring is gated by the `log-lesson` skill.** The skill reads this list before
writing; an unrecognized tag is not written silently — it is confirmed with the
user, and on approval added here in the same change, so vocabulary growth is an
auditable diff.

Current vocabulary:

```text
node, powershell, bash, python, sqlite, sql-server, css, html, http, git,
claude-code, concurrency, locking, security, encoding, regex, testing,
ci, hooks, parsing, performance, filesystem, api, markdown
```

Parsing/forward-compat: the current viewer parser (`parseMd`) extracts only
Problem/Solution/Takeaway, so a `**Stack:**` line placed before `**Problem:**`
rides through sync into the global log and the dedup hash untouched, and is simply
not surfaced in the viewer UI yet. Explicit Stack parsing + extension→tag scoring
land with Phase 2 — this section is the single source both will read.

## Dedup key

`bare_header + "|" + sha1(normalized_body)[:12]` where the header has its provenance
comment stripped and the body excludes blank lines and `**Project:**` lines. This is
rename-proof, clone-proof, and path-move-proof: the same lesson synced from a second
project merges provenance instead of duplicating.

## Schema version

The global file carries **one file-level marker** in its intro block:

```markdown
# Global Skills Log
<!-- skill-trace-schema: 1 -->
```

Semantics:

1. **Missing marker = schema 1.** Files written by releases before this marker
   existed have no marker; parsers MUST treat absence as v1, never error.
2. **Writer-migrates-before-append.** A writer whose schema is newer than the
   file's marker MUST bump/migrate the file (and its entries, if the bump requires
   it) **before** appending. This keeps a file internally coherent at one version.
3. **Best-effort on unknown-newer.** A parser reading a marker newer than it
   understands parses what it can as v1 and warns; it does not crash.

### Reserved for schema 2+ (not implemented — do not write code for this yet)

From schema 2 onward, an individual entry MAY carry a per-entry version override
**inside its provenance comment**, before a `|` separator:

```markdown
## [2026-07-01] — Title <!-- v2 | proj-a, proj-b -->
```

This is the designed escape hatch for files that legitimately hold mixed-version
entries (e.g. team git-sync or multi-machine sync merging entries written by
different plugin versions). It is **specified, not built** — current `entryKey`
already strips the whole comment, so hashes stay stable when this arrives. Until a
real mixed-version scenario exists (Phase 3 team sync, conditional), the file-level
marker is the only version signal and no per-entry token is written or read.
