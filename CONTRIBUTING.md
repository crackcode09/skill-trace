# Contributing to skill-trace

Thanks for taking an interest in skill-trace. This is a small, intentionally simple project — the entire server is ~110 lines with zero dependencies. Getting started takes minutes.

---

## `// ground rules`

- Keep it simple. No new dependencies without a strong reason.
- One concern per PR. Don't bundle unrelated fixes.
- Test your change manually before opening a PR — `node viewer/server.js` and verify `/api/skills` returns entries.
- Branch protection is on `dev` and `master` — all changes go through a PR, and CI must be green on all three OSes before merge.

---

## `// development setup`

```bash
git clone https://github.com/crackcode09/skill-trace
cd skill-trace

# Start the viewer server (or: node viewer/server.js)
npm run dev

# Or a throwaway instance on fictional demo data, port 38890
npm run demo

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
master  ←  PR from dev only  ←  dev  ←  your PR  ←  feat/your-feature-name
```

`dev` is the permanent integration branch. Every change lands there first; `master` is
what the plugin marketplace installs, so it only moves when `dev` is promoted by PR.

1. Fork the repo
2. Branch from `dev`: `feat/your-feature` or `fix/your-fix` — never a `dev/...` or `master/...`
   prefix (git stores branches as paths, so those names collide with the `dev` and `master` branches)
3. Make your change and test it locally (`npm test` in `viewer/`, then run the viewer)
4. Open a PR against `dev` — CI runs on ubuntu, windows and macos and must be green
5. Once `dev` has been exercised locally, promote it with a `dev → master` PR

Commit format: `type: short description`
Types: `feat`, `fix`, `style`, `refactor`, `docs`, `security`, `config`

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
