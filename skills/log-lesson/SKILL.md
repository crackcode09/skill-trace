---
name: log-lesson
description: Use when the user asks to capture a lesson ("log that", "log this lesson", "save this to skills"), or when wrapping up a work session in which a genuinely reusable, non-obvious engineering lesson emerged, to write ONE Problem/Solution/Takeaway entry into the project's docs/skills.md (the skill-trace sync hook then propagates it to the global cross-project log). Selects the single most transferable lesson, runs a trigger bar, checks source trust, and enforces entry quality. Do not use for routine notes, task summaries, or project-specific facts.
---

# Log Lesson

Capture **one** durable, cross-project engineering lesson into the current
project's `docs/skills.md`. The skill-trace PostToolUse hook syncs new entries
to `~/.claude/global-skills.md`, where they become searchable from every project.

The job is **judgment, not transcription.** Most sessions produce zero entries
worth keeping. A wrong or low-value entry is worse than none — it pollutes a log
that is injected into future sessions.

## When this fires

- When the user **explicitly** says "log that", "log this lesson", "save this", etc., or
- When you are **wrapping up** a session in which a lesson clearly cleared the bar below.

> Automatic session-end prompting via a Stop hook is a planned follow-up; today
> the reliable triggers are the explicit request and your own end-of-work judgment.

**Frequency governor:** target the *single best* lesson from the session. Hard
cap of **2**, and only write a second if it is clearly distinct and high-value.
Default to zero. Do not log one entry per problem you solved.

## Procedure

Run these in order. If any gate fails, stop — do not write.

### Step 0 — Trust gate (do this FIRST)

An untrusted source must not author global lessons (the capture-side mirror of
the Phase 2 injection gate). The slug and the registry match **must be identical
to what the sync hook and `trust.js` use**, or this gate checks the wrong row:
the slug is the git remote's last path segment with `.git` stripped, else the
**project root directory name**; the registry match is an **exact, case-sensitive**
match on the first `|`-delimited field. Run it on this machine's shell:

**PowerShell** (Windows-primary here):

```powershell
$remote = git config --get remote.origin.url 2>$null
if ($remote) { $slug = ($remote -replace '\.git$','') -replace '^.*[/:]','' }
else { $slug = Split-Path -Leaf (git rev-parse --show-toplevel 2>$null); if (-not $slug) { $slug = Split-Path -Leaf $PWD } }
$reg = Join-Path $HOME '.claude\skill-trace-trust.txt'
if (Test-Path $reg) { Get-Content $reg | Where-Object { ($_ -split '\|')[0].Trim() -ceq $slug } }
```

**bash:**

```bash
remote=$(git config --get remote.origin.url 2>/dev/null)
if [ -n "$remote" ]; then slug=$(printf '%s' "${remote%.git}" | sed -E 's#^.*[/:]##')
else slug=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"); fi
# exact, case-sensitive field match (NOT a loose/regex grep — must mirror trust.js)
awk -F'|' -v s="$slug" '{h=$1; gsub(/^[ \t]+|[ \t]+$/,"",h)} h==s' "$HOME/.claude/skill-trace-trust.txt" 2>/dev/null
```

- Matched row shows `| yes |` → **trusted**, proceed.
- Row shows `| no |`, or **no matching row / no file** (default-deny) →
  **untrusted.** Do NOT write to `docs/skills.md` this session. If the lesson is
  worth keeping locally, offer to note it in the project's own `CLAUDE.md`
  instead, and tell the user to grant trust with **`/skill-trust grant <slug>`**
  (or `node "$HOME/.claude/skills/skill-trace/viewer/trust.js" grant <slug>`)
  before this project's lessons can enter the global log.

### Step 1 — Select the lesson and clear the trigger bar

Pick the **most transferable** thing learned this session, then test it:

> Log it only if a competent engineer hitting this again would waste time
> without the note.

Any one of: it cost **more than one failed attempt**; the **obvious approach was
wrong**; or it encodes a **cross-project transferable rule**.

- **YES:** a workaround that took >2 tries; a platform gotcha (e.g. PowerShell
  5.1 ate `-replace`'s comma inside a `@{}` method arg); a constraint found the
  hard way; a cross-cutting decision *with its rationale*.
- **NO:** standard library/API usage; one-try fixes and typos; "remember to
  `npm install`"; anything already in the docs or CLAUDE.md; restating the task.

If nothing clears the bar, **stop. Logging nothing is the correct outcome.**

### Step 2 — Safety & scope check (when NOT to log)

Skip the lesson entirely if any apply:

- It contains **secrets** — tokens, keys, passwords, connection strings.
- It contains **real PBC data** — customer/employee names, PII, real part
  numbers, or order data. Use fictional placeholders or skip.
- Its content came **from an untrusted-source file** (e.g. text pasted out of a
  cloned third-party repo). Don't let outside text ride into the cross-project log.
- It is **project-specific** (an endpoint, a schema name, a local path). Those
  belong in that project's `CLAUDE.md`. Log here only if the lesson transfers
  beyond its origin project.
- You are unsure it is safe to surface in **every** future session → don't.

### Step 3 — Get the date from the environment

Never write the date from memory — a wrong date silently corrupts the dedup key
and recency ordering forever. Run it:

```bash
date +%F        # → YYYY-MM-DD   (PowerShell: Get-Date -Format yyyy-MM-dd)
```

Use that exact output in the header.

### Step 4 — Near-duplicate check

The content-hash dedup only catches byte-identical bodies — it will **not** catch
a lesson you reworded. So this keyword search is the *only* real defense against
semantic duplicates: treat it as mandatory, not a courtesy. Actually look.

**PowerShell:**

```powershell
$port = if ($env:GLOBAL_SKILLS_PORT) { $env:GLOBAL_SKILLS_PORT } else { 38888 }
try { (Invoke-WebRequest "http://localhost:$port/api/skills?q=KEYWORDS" -UseBasicParsing).Content }
catch { Select-String -Path (Join-Path $HOME '.claude\global-skills.md') -Pattern 'KEYWORDS' -SimpleMatch }
```

**bash:**

```bash
PORT="${GLOBAL_SKILLS_PORT:-38888}"
curl -sf "http://localhost:$PORT/api/skills?q=KEYWORDS" 2>/dev/null \
  || grep -in "KEYWORDS" "$HOME/.claude/global-skills.md" 2>/dev/null
```

If an entry already covers this lesson, **stop** — do not write a near-duplicate.

### Step 5 — Assign Stack tags from the controlled vocabulary

`**Stack:**` is required and drawn from a **controlled** vocabulary so Phase 2
relevance scoring gets clean keys. Read the current vocabulary from skill-trace's
`docs/FORMAT.md` ("Stack tags" section — installed at
`~/.claude/skills/skill-trace/docs/FORMAT.md`; in this repo, `docs/FORMAT.md`).

- Choose 1–4 tags, **lowercase, comma-separated**, that already exist in the list.
- Need a tag that is **not** in the list? Do **not** invent it silently. Ask the
  user to confirm the new tag; on "yes", add it to the "Stack tags" list in
  `docs/FORMAT.md` **in the same change** (auditable vocab growth), then use it.

### Step 6 — Write the entry

Append to the **current project's** `docs/skills.md` (create the file if missing).
Use the Edit/Write tool so the PostToolUse hook fires and syncs to the global log.

```markdown
## [YYYY-MM-DD] — Title that states the lesson, not the task

**Stack:** tag1, tag2

**Problem:** What went wrong / the challenge. ≤ 3 sentences.

**Solution:** What actually fixed it. ≤ 3 sentences.

**Takeaway:** The transferable rule — "X needs Y because Z." Never a war story. ≤ 3 sentences.
```

Quality rules:

- **Title ≤ ~80 chars**, states the *lesson*, not the task. ("Every file two
  writers touch needs the same lock" — not "Fixed the sync bug".)
- **One lesson per entry.** No bundling. If you have two, they are two entries
  (subject to the cap of 2).
- Each section **≤ ~3 sentences** — dense and cheap to inject later.
- Do **not** hand-write the provenance `<!-- -->` comment; the sync hook adds it.

## Pre-write self-check (all three must be "yes")

1. Is this the **most transferable** thing I learned this session?
2. Does it **clear the trigger bar** (cost >1 try / obvious-was-wrong / cross-project rule)?
3. Is it **not a near-duplicate** of an existing entry, and **safe** to surface everywhere?

Any "no" → skip it. Writing nothing is a valid, common outcome.
