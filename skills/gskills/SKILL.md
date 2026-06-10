---
name: gskills
description: This skill should be used when the user invokes "/gskills", asks to "search global skills", "search my skills log", "find a skill about X", "what do I know about X", or wants to look up past lessons from across all projects.
---

# Global Skills Search

Search `~/.claude/global-skills.md` — the cross-project skills log populated by skill-trace — and display matching entries.

## Steps

### 1. Build the query URL

- If `args` is non-empty: `http://localhost:38888/api/skills?q=<args>`
- If `args` is empty: `http://localhost:38888/api/skills` (returns all entries, most recent first)

### 2. Fetch results

Use the Bash tool:

```bash
curl -sf "http://localhost:38888/api/skills?q=QUERY" 2>/dev/null
```

### 3. Handle failures

- **Connection refused / empty response**: the viewer is not running. Tell the user: "The skill-trace viewer isn't running. Start a new Claude Code session (SessionStart hook launches it automatically), or run `node ~/.claude/skills/skill-trace/viewer/server.js` manually."
- **Empty array `[]`**: no matches. Say: "No skills found matching '`<args>`'."

### 4. Format results

For each entry in the JSON array, display:

```
[date] — title  (project)

  Problem:  ...
  Takeaway: ...
```

Group by project if more than 5 results. Cap display at 10 entries; if more match, say "Showing 10 of N — narrow your search with a more specific keyword."

Omit fields that are `null`.
