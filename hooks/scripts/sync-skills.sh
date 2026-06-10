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
import sys, json, re, os, hashlib

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

# Infer project name: prefer git remote slug (stable across renames), fall back to folder name
normalized = file_path.replace('\\', '/')
parts = normalized.split('/')
project_name = 'unknown-project'
for i in range(len(parts) - 1, -1, -1):
    if parts[i] == 'docs' and i > 0:
        project_name = parts[i - 1]
        break
try:
    import subprocess
    git_dir = os.path.dirname(os.path.abspath(file_path))
    r = subprocess.run(['git', '-C', git_dir, 'config', '--get', 'remote.origin.url'],
                       capture_output=True, text=True, timeout=2)
    if r.returncode == 0:
        url  = r.stdout.strip()
        slug = re.sub(r'\.git$', '', url.split('/')[-1].split(':')[-1])
        if slug:
            project_name = slug
except Exception:
    pass

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

# Content-hash dedup: key = bare_header + sha1(normalized_body)[:12]
# Rename-proof, clone-proof, path-move-proof.
# Two different lessons with the same title still both sync — their bodies differ.
def entry_key(entry):
    lines = entry.split('\n')
    header = re.sub(r'\s*<!--.*?-->\s*$', '', lines[0].strip())
    body_lines = [l.strip() for l in lines[1:]
                  if l.strip() and not l.strip().startswith('**Project:**')]
    body = '\n'.join(body_lines)
    h = hashlib.sha1(body.encode('utf-8')).hexdigest()[:12]
    return header + '|' + h

# Build key→header map from existing global content
existing_keys = {}
if global_content:
    for block in re.split(r'(?m)(?=^## \[?\d{4}-\d{2}-\d{2}\]?)', global_content):
        block = block.strip()
        if not block or not re.match(r'^## \[?\d{4}-\d{2}-\d{2}\]?', block):
            continue
        k = entry_key(block)
        existing_keys[k] = block.split('\n')[0].strip()

new_entries = []
provenance_edits = []
for entry in entries:
    key = entry_key(entry)
    if key in existing_keys:
        existing_header = existing_keys[key]
        m = re.search(r'<!--\s*(.+?)\s*-->', existing_header)
        if m:
            existing_projects = [p.strip() for p in m.group(1).split(',')]
            if project_name not in existing_projects:
                new_comment = '<!-- {} -->'.format(', '.join(existing_projects + [project_name]))
                new_header = re.sub(r'<!--\s*.+?\s*-->', new_comment, existing_header)
                provenance_edits.append((existing_header, new_header))
    else:
        new_entries.append(entry)

# Apply provenance merges in one file rewrite
if provenance_edits:
    updated = global_content
    for old_h, new_h in provenance_edits:
        updated = updated.replace(old_h, new_h, 1)
    try:
        with open(global_path, 'w', encoding='utf-8') as f:
            f.write(updated)
        global_content = updated
    except Exception:
        pass

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
            body = '\n'.join(rest).lstrip('\n')
            full_entry = '\n' + tagged_header + '\n\n' + body
            f.write(full_entry)
except Exception:
    sys.exit(0)

sys.exit(0)
PYEOF

exit 0
