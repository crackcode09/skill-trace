# sync-skills.ps1
# PostToolUse hook: syncs new docs/skills.md entries to ~/.claude/global-skills.md
# Receives Claude Code event JSON on stdin.

param()

# Gate: only run on Windows. Handles PowerShell Core installed on macOS/Linux.
if ($env:OS -ne 'Windows_NT') { exit 0 }

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$stdin = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($stdin)) { exit 0 }

try {
    $data = $stdin | ConvertFrom-Json
} catch {
    exit 0
}

$tool_name  = $data.tool_name
$tool_input = $data.tool_input
if ($null -eq $tool_input) { exit 0 }

$file_path = $tool_input.file_path
if ([string]::IsNullOrEmpty($file_path)) { exit 0 }

# Only act on the configured source path. Default = docs/skills.md (unchanged
# behavior). Set SKILL_TRACE_SOURCE_PATTERN to a regex to opt other files in
# (e.g. 'LESSONS\.md$' or 'docs[/\\]skills\.md$|LESSONS\.md$'). Unset = default.
$source_pattern = $env:SKILL_TRACE_SOURCE_PATTERN
if ([string]::IsNullOrEmpty($source_pattern)) { $source_pattern = 'docs[/\\]skills\.md$' }
if ($file_path -notmatch $source_pattern) { exit 0 }

# Determine content to parse
$content = ''
if ($tool_name -eq 'Write') {
    $content = $tool_input.content
} elseif ($tool_name -eq 'Edit') {
    # Only bother reading if the Edit added a new ## entry
    # Accept both ## [YYYY-MM-DD] and ## YYYY-MM-DD formats
    $new_string = $tool_input.new_string
    if ($new_string -notmatch '(?m)^## (\[?\d{4}-\d{2}-\d{2}\]?)') { exit 0 }
    # PostToolUse fires after the edit is applied — read current file state
    if (Test-Path $file_path) {
        $content = Get-Content $file_path -Raw -Encoding UTF8
    } else { exit 0 }
}

if ([string]::IsNullOrEmpty($content)) { exit 0 }

# Strip a leading UTF-8 BOM. A file authored/edited by an external editor can carry
# one; left in place it prefixes the first '## ' header so the entry never matches
# and the file parses to zero entries.
$content = $content -replace "^$([char]0xFEFF)", ""

# Infer project name: prefer git remote slug (stable across renames), fall back to folder name
$normalized = $file_path -replace '\\', '/'
$parts = $normalized -split '/'
$project_name = 'unknown-project'
for ($i = $parts.Length - 1; $i -ge 0; $i--) {
    if ($parts[$i] -eq 'docs' -and $i -gt 0) {
        $project_name = $parts[$i - 1]
        break
    }
}
try {
    $git_dir    = Split-Path $file_path
    $git_remote = & git -C $git_dir config --get remote.origin.url 2>$null
    if ($git_remote) {
        $slug = ($git_remote -replace '\.git$', '') -replace '^.*[/:]', ''
        if ($slug) { $project_name = $slug }
    }
} catch {}

# ── File lock ────────────────────────────────────────────────────────────────
# Serialize the whole sync critical section across concurrent sessions (the OS
# gate only separates ps1-vs-sh, not session-vs-session). Bounded retry; steal a
# lock older than 15s. The same implementation guards both the registry and the
# global log — one set of timeout rules, never two that can diverge.
function Acquire-FileLock([string]$lockPath) {
    for ($i = 0; $i -lt 50; $i++) {
        try {
            $fs = [System.IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None')
            $fs.Close(); return $true
        } catch {
            try {
                if ((Test-Path $lockPath) -and (((Get-Date) - (Get-Item $lockPath).LastWriteTime).TotalSeconds -gt 15)) {
                    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue; continue
                }
            } catch {}
            Start-Sleep -Milliseconds 30
        }
    }
    return $false
}
function Release-FileLock([string]$lockPath) {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}

# Record this source in the trust registry as UNTRUSTED if not already present.
# Caller already holds the sync lock. Invariant: the hook only ever ADDS rows as
# 'no'. Trust is granted only by the human (/skill-trust or manual edit), never
# here, never from synced content. Capture is never gated on this; only Phase 2
# injection reads it.
function Record-Source([string]$slug) {
    if ([string]::IsNullOrWhiteSpace($slug)) { return }
    $trustPath = Join-Path $env:USERPROFILE '.claude\skill-trace-trust.txt'
    try {
        if (Test-Path $trustPath) {
            foreach ($line in (Get-Content $trustPath -Encoding UTF8)) {
                $t = $line.Trim()
                if ($t -eq '' -or $t.StartsWith('#')) { continue }
                if (($t -split '\|')[0].Trim() -eq $slug) { return }  # already recorded
            }
        } else {
            $header = @"
# skill-trace source trust registry
# columns: project-slug | trusted(yes|no) | first-seen | granted-at | granted-by
# The sync hook only ever ADDS rows as 'no'. Granting trust (no -> yes) is done
# ONLY by you: the /skill-trust command or editing this file. Phase 2 injection
# uses 'yes' rows only. Trust is never decided from synced file content.
"@
            Set-Content $trustPath $header -Encoding UTF8
        }
        $today = (Get-Date).ToString('yyyy-MM-dd')
        Add-Content $trustPath ("$slug | no | $today |  | ") -Encoding UTF8
    } catch {}
}

# Parse ## [...] or ## YYYY-MM-DD skill entry blocks from content
# Normalize: add brackets if missing so global-skills.md stays consistent
$entries = [System.Collections.Generic.List[string]]::new()
$current  = $null
foreach ($line in ($content -split "`n")) {
    if ($line -match '^## (\[?\d{4}-\d{2}-\d{2}\]?)') {
        if ($null -ne $current) { $entries.Add($current.TrimEnd()) }
        # Normalize to bracketed format: ## [YYYY-MM-DD] — Title
        $normalized_line = $line -replace '^## (\d{4}-\d{2}-\d{2})', '## [$1'
        if ($normalized_line -match '^## \[\d{4}-\d{2}-\d{2}(?!\])') {
            $normalized_line = $normalized_line -replace '^(## \[\d{4}-\d{2}-\d{2})', '$1]'
        }
        $current = $normalized_line
    } elseif ($null -ne $current) {
        $current += "`n" + $line
    }
}
if ($null -ne $current) { $entries.Add($current.TrimEnd()) }
if ($entries.Count -eq 0) { exit 0 }

# Take ONE sync-wide lock covering BOTH the trust-registry write and the global-log
# read -> dedup -> append. One lock for both = no lock ordering, no deadlock. Fail
# OPEN: if it can't be acquired, skip the sync and exit 0 — the entry stays in the
# project's docs/skills.md and re-syncs on the next hook fire (retry by design).
$claudeDir = Join-Path $env:USERPROFILE '.claude'
try { if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null } } catch { exit 0 }
$syncLock = Join-Path $claudeDir 'skill-trace-sync.lock'
if (-not (Acquire-FileLock $syncLock)) { exit 0 }

try {
Record-Source $project_name

# Global skills file
$global_path = Join-Path $env:USERPROFILE '.claude\global-skills.md'

$global_content = ''
if (Test-Path $global_path) {
    $global_content = Get-Content $global_path -Raw -Encoding UTF8
}

# Content-hash dedup: key = bare_header + sha1(normalized_body)[:12]
# Rename-proof, clone-proof, path-move-proof.
# Two different lessons with the same title still both sync — their bodies differ.
function Get-EntryKey([string]$entry) {
    $lines  = $entry -split "`n"
    $header = $lines[0].Trim() -replace '\s*<!--.*?-->\s*$', ''
    $body   = (($lines[1..($lines.Length - 1)] |
        Where-Object { $_.Trim() -ne '' -and $_.Trim() -notmatch '^\*\*Project:\*\*' } |
        ForEach-Object { $_.Trim() }) -join "`n")
    $bytes  = [System.Text.Encoding]::UTF8.GetBytes($body)
    $sha    = [System.Security.Cryptography.SHA1]::Create()
    $hash   = ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').Substring(0, 12).ToLower()
    return "$header|$hash"
}

# Build key→header map from existing global file
$existing_keys = @{}
if ($global_content) {
    ($global_content -split '(?m)(?=^## \[?\d{4}-\d{2}-\d{2}\]?)') |
        Where-Object { $_ -match '^## \[?\d{4}-\d{2}-\d{2}\]?' } |
        ForEach-Object {
            $k = Get-EntryKey $_.TrimEnd()
            $existing_keys[$k] = ($_.TrimEnd() -split "`n")[0].Trim()
        }
}

$new_entries      = [System.Collections.Generic.List[string]]::new()
$provenance_edits = [System.Collections.Generic.List[hashtable]]::new()

foreach ($entry in $entries) {
    $key = Get-EntryKey $entry
    if ($existing_keys.ContainsKey($key)) {
        # Same content already exists — merge project into attribution comment if new
        $existing_header   = $existing_keys[$key]
        if ($existing_header -match '<!--\s*(.+?)\s*-->') {
            $existing_projects = @($Matches[1] -split ',\s*' | ForEach-Object { $_.Trim() })
            if ($existing_projects -notcontains $project_name) {
                $new_comment = "<!-- $(($existing_projects + $project_name) -join ', ') -->"
                $provenance_edits.Add(@{
                    Old = $existing_header
                    New = ($existing_header -replace '<!--\s*.+?\s*-->', $new_comment)
                })
            }
        }
    } else {
        $new_entries.Add($entry)
    }
}

# Apply provenance merges in one file rewrite
if ($provenance_edits.Count -gt 0) {
    foreach ($edit in $provenance_edits) {
        $global_content = $global_content.Replace($edit.Old, $edit.New)
    }
    Set-Content $global_path $global_content -Encoding UTF8
}

# Guard, not early-exit, so the lock always releases via finally. Provenance
# merges above already wrote; only genuinely new entries get appended.
if ($new_entries.Count -gt 0) {
    # Bootstrap global file if it doesn't exist yet
    if (-not (Test-Path $global_path)) {
        $init = @"
# Global Skills Log
<!-- skill-trace-schema: 1 -->

> Auto-synced from all project ``docs/skills.md`` files.
> Each entry is tagged with its source project.
> Search at http://localhost:38888

"@
        Set-Content $global_path $init -Encoding UTF8
    }

    # Append each new entry with project attribution injected into the header line
    foreach ($entry in $new_entries) {
        $lines = $entry -split "`n"
        $tagged_header = $lines[0].TrimEnd() + " <!-- $project_name -->"
        $rest_lines    = if ($lines.Length -gt 1) { $lines[1..($lines.Length - 1)] } else { @() }
        $body          = $rest_lines -join "`n"
        $full_entry    = "`n" + $tagged_header + "`n`n" + $body.TrimStart("`n")
        Add-Content $global_path $full_entry -Encoding UTF8
    }
}
} finally {
    Release-FileLock $syncLock
}

exit 0
