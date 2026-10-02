# Demo data — dashboard showcase

`skills-demo.md` is a set of **fictional** lessons (no real PBC data) with
`**Stack:**` tags, used to demo the **Dashboard** view (group lessons by tool/stack)
without touching your real `~/.claude/global-skills.md`.

## Launch the demo viewer

Run a throwaway viewer instance pointed at the demo file, on a separate port so
it never collides with your real viewer on 38888:

**PowerShell (Windows):**

```powershell
$env:GLOBAL_SKILLS_MD_PATH = "$PWD\demo\skills-demo.md"
$env:GLOBAL_SKILLS_PORT = "38890"
node viewer/server.js
```

**bash (macOS/Linux):**

```bash
GLOBAL_SKILLS_MD_PATH="$PWD/demo/skills-demo.md" GLOBAL_SKILLS_PORT=38890 node viewer/server.js
```

Then open <http://localhost:38890> and click **Dashboard** in the top bar. Each
bar is a Stack tag; click one to drill into its lessons. Press Ctrl-C to stop —
your real log and viewer are untouched.
