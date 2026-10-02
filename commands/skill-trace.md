---
description: Manage this project's skill-trace lesson store — forget a lesson, run a sync by hand, or show status
argument-hint: "[forget <id|title text>|sync|status]"
allowed-tools: Bash(node:*)
---

Operate on the **current project's** lesson store (`.claude/skill-trace/lessons/`).
Lessons are one file each; nothing here touches another project. The global store
is managed from the viewer (delete) and `/skill-trust` (which projects sync).

Run, from the project root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/viewer/store.js" $ARGUMENTS --project="$PWD"
```

Subcommands:

- `status` — lesson count, slug, whether this project is trusted (syncs globally),
  lessons edited by hand, recurring lessons, and whether a `docs/skills.md` rollup
  is maintained here.
- `forget <id|title text>` — delete one lesson by id, or by a title fragment that
  matches **exactly one** lesson. If the fragment is ambiguous the command refuses
  and lists the candidates; relay them and ask the user which one. A tombstone is
  recorded so the lesson cannot be re-synced back in. The global copy, if any, is
  **not** removed — say so, and point to the viewer's Delete for that.
- `sync` — absorb any hand-written entries, re-bless hand-edited lessons,
  regenerate the index (and the rollup if one exists), and mirror to the global
  store if trusted. Normally the PostToolUse hook does this on every save.

With no arguments, run `status`.

Report the JSON result to the user in one or two plain-language lines. Never
invent an id; use only ids from `status`/`forget` output or from the viewer.
