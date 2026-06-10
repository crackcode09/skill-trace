# global-skills — Claude Code Plugin

Automatically syncs skill entries from any project's `docs/skills.md` to a central `~/.claude/global-skills.md` log, with cross-project attribution. Includes a local web viewer for searching and browsing your institutional knowledge base.

## What it does

- **PostToolUse hook** — fires after every `Write` or `Edit` to any `docs/skills.md`. Extracts `## [YYYY-MM-DD]` entries and appends them to `~/.claude/global-skills.md` with a `**Project:** name` attribution line.
- **Web viewer** — starts at session begin on `http://localhost:38888`. 3-column split-pane UI (projects | entries | detail). Full-text search powered by SQLite FTS5.
- **`/gskills` skill** — search the global log from within Claude Code.

## Install

```bash
claude plugin install github:YOUR_USERNAME/global-skills
```

Then add the `SessionStart` hook to your `~/.claude/settings.json` (see **Manual hook wiring** below).

## Manual hook wiring

The `PostToolUse` hooks run automatically via the plugin system. The `SessionStart` hook for the viewer requires a one-time manual entry in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File \"C:\\Users\\USERNAME\\.claude\\skills\\global-skills\\hooks\\scripts\\start-viewer.ps1\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `USERNAME` with your Windows username.

## Usage

```bash
/gskills                              # 10 most recent entries
/gskills sql server                   # search by keyword
/gskills --project rma_process_automate
/gskills --recent 20
```

Web viewer: open `http://localhost:38888` in any browser after starting a Claude Code session.

## How skill entries are captured

In any project, write entries to `docs/skills.md` using this format:

```markdown
## [YYYY-MM-DD] — Skill Title

**Problem:** What went wrong or what challenge was faced.

**Solution:** What was done to solve it.

**Takeaway:** The reusable lesson.
```

The hook fires automatically and appends the entry to the global log.

## Platform support

- **Windows (PowerShell):** fully supported — hooks and viewer are `.ps1` scripts
- **Mac/Linux:** `sync-skills.ps1` is Windows-only in v1.1.0. Shell script equivalents are welcome as community contributions.

## Files

```
global-skills/
├── viewer/
│   ├── server.js          # Node.js HTTP server (port 38888)
│   ├── package.json       # better-sqlite3 dependency
│   └── public/
│       └── index.html     # 3-column viewer UI
├── hooks/
│   ├── hooks.json
│   └── scripts/
│       ├── sync-skills.ps1    # PostToolUse: MD sync
│       └── start-viewer.ps1   # SessionStart: viewer startup
├── skills/
│   └── gskills/
│       └── SKILL.md       # /gskills command
├── .claude-plugin/
│   └── plugin.json
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
