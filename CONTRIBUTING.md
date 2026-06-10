# Contributing to skill-trace

Thanks for taking an interest in skill-trace. This is a small, intentionally simple project — the entire server is ~110 lines with zero dependencies. Getting started takes minutes.

---

## `// ground rules`

- Keep it simple. No new dependencies without a strong reason.
- One concern per PR. Don't bundle unrelated fixes.
- Test your change manually before opening a PR — `node viewer/server.js` and verify `/api/skills` returns entries.
- Branch protection is on `master` — all changes go through a PR.

---

## `// development setup`

```bash
git clone https://github.com/crackcode09/skill-trace
cd skill-trace

# Start the viewer server
node viewer/server.js

# Verify it works
curl http://localhost:38888/api/skills
```

No `npm install` needed — zero dependencies.

To test the sync hook manually:

```bash
# Append a test entry to the global skills file
echo "## 2026-01-01 — Test Entry

**Problem:** Testing the sync.

**Solution:** Added a test entry.

**Takeaway:** Sync works." >> ~/.claude/global-skills.md

# Trigger a manual re-sync
curl -X POST http://localhost:38888/api/sync

# Verify the new entry appears
curl http://localhost:38888/api/skills | grep "Test Entry"
```

---

## `// what to work on`

Good first contributions:

| Area | What's needed |
|------|--------------|
| **Search** | Fuzzy/proximity matching to replace simple substring filter |
| **Hook scripts** | Better error messages when `global-skills.md` is missing |
| **Viewer UI** | Keyboard navigation (j/k to move between entries) |
| **Entry format** | Support additional field names beyond Problem/Solution/Takeaway |
| **Tests** | Any automated test coverage — currently zero |

Bigger items (check roadmap in README first):

- **v1.3.0** — PreToolUse hook that injects relevant skills into Claude's context automatically
- **v2.0.0** — Multi-developer sync via shared git repo or API backend

---

## `// branch + PR flow`

```
master  ←  your PR  ←  feat/your-feature-name
```

1. Fork the repo
2. Create a branch: `feat/your-feature` or `fix/your-fix`
3. Make your change, test it
4. Open a PR against `master`
5. 1 approval required to merge

Commit format: `type: short description`
Types: `feat`, `fix`, `style`, `refactor`, `docs`, `config`

---

## `// file map`

```
viewer/server.js          ← HTTP server + MD parser + in-memory search (110 lines)
viewer/public/index.html  ← 3-column viewer UI (vanilla JS + CSS)
hooks/scripts/sync-skills.ps1   ← PostToolUse hook (Windows)
hooks/scripts/start-viewer.ps1  ← SessionStart hook (Windows)
hooks/scripts/start-viewer.sh   ← SessionStart hook (macOS/Linux)
skills/gskills/SKILL.md         ← /gskills slash command definition
```

---

## `// questions`

Open an issue. No formal process — just describe what you're trying to do.
