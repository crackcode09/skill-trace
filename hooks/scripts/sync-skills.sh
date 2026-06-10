#!/usr/bin/env bash
# sync-skills.sh
# PostToolUse hook: syncs new docs/skills.md entries to ~/.claude/global-skills.md
# Runs on macOS/Linux — mirrors sync-skills.ps1 logic

# Never error out — hooks must be silent on failure
set +e

# Gate: Windows (Git Bash / MSYS / Cygwin) is handled by sync-skills.ps1.
# Exiting here prevents a TOCTOU race where both scripts append simultaneously.
case "$OSTYPE" in
  msys*|cygwin*|win32*) exit 0 ;;
esac

# Require python3
command -v python3 >/dev/null 2>&1 || exit 0

# Read stdin
stdin=$(cat 2>/dev/null || true)
[[ -z "$stdin" ]] && exit 0

# Pass JSON via env var to avoid quoting/escaping issues with special chars
SKILL_TRACE_INPUT="$stdin" python3 << 'PYEOF'
import sys, json, re, os

raw = os.environ.get('SKILL_TRACE_INPUT', '')

try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)

tool_name  = data.get('tool_name', '')
tool_input = data.get('tool_input') or {}
file_path  = tool_input.get('file_path', '')

if not file_path:
    sys.exit(0)

# Only act on docs/skills.md writes
if not re.search(r'docs[/\\]skills\.md$', file_path):
    sys.exit(0)

# Determine content to parse
content = ''
if tool_name == 'Write':
    content = tool_input.get('content', '')
elif tool_name == 'Edit':
    new_string = tool_input.get('new_string', '')
    if not re.search(r'(?m)^## (\[?\d{4}-\d{2}-\d{2}\]?)', new_string):
        sys.exit(0)
    # PostToolUse fires after edit is applied — read current file state
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        sys.exit(0)

if not content:
    sys.exit(0)

# Infer project name: parent of the docs/ folder
normalized = file_path.replace('\\', '/')
parts = normalized.split('/')
project_name = 'unknown-project'
for i in range(len(parts) - 1, -1, -1):
    if parts[i] == 'docs' and i > 0:
        project_name = parts[i - 1]
        break

# Parse ## [...] or ## YYYY-MM-DD skill entry blocks
# Normalize: add brackets if missing so global-skills.md stays consistent
entries = []
current = None
for line in content.split('\n'):
    if re.match(r'^## \[?\d{4}-\d{2}-\d{2}\]?', line):
        if current is not None:
            entries.append(current.rstrip())
        # Normalize bare dates to bracketed format
        line = re.sub(r'^## (\d{4}-\d{2}-\d{2})(?!\])', r'## [\1]', line)
        current = line
    elif current is not None:
        current += '\n' + line

if current is not None:
    entries.append(current.rstrip())

if not entries:
    sys.exit(0)

global_path = os.path.join(os.path.expanduser('~'), '.claude', 'global-skills.md')

global_content = ''
if os.path.exists(global_path):
    try:
        with open(global_path, 'r', encoding='utf-8') as f:
            global_content = f.read()
    except Exception:
        pass

# Filter to entries whose header doesn't yet exist in global log.
# Dedup on bare title+date only (strip <!-- --> comment before checking)
# so project renames don't create duplicates — same lesson is same lesson.
new_entries = []
for entry in entries:
    header = entry.split('\n')[0].strip()
    bare_header = re.sub(r'\s*<!--.*-->$', '', header)
    if bare_header not in global_content:
        new_entries.append(entry)

if not new_entries:
    sys.exit(0)

# Bootstrap global file if it doesn't exist yet
if not os.path.exists(global_path):
    try:
        os.makedirs(os.path.dirname(global_path), exist_ok=True)
        init = (
            '# Global Skills Log\n\n'
            '> Auto-synced from all project `docs/skills.md` files.\n'
            '> Each entry is tagged with its source project.\n'
            '> Search at http://localhost:38888\n\n'
        )
        with open(global_path, 'w', encoding='utf-8') as f:
            f.write(init)
        global_content = init
    except Exception:
        sys.exit(0)

# Append each new entry with project attribution injected into the header line
try:
    with open(global_path, 'a', encoding='utf-8') as f:
        for entry in new_entries:
            lines = entry.split('\n')
            tagged_header = lines[0].rstrip() + ' <!-- {} -->'.format(project_name)
            rest = lines[1:] if len(lines) > 1 else []
            attribution = '**Project:** `{}`'.format(project_name)
            body = '\n'.join(rest).lstrip('\n')
            full_entry = '\n' + tagged_header + '\n\n' + attribution + '\n' + body
            f.write(full_entry)
except Exception:
    sys.exit(0)

sys.exit(0)
PYEOF

exit 0
