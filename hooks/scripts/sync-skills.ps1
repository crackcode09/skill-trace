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

# Only act on docs/skills.md writes
if ($file_path -notmatch 'docs[/\\]skills\.md$') { exit 0 }

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
                    New = $existing_header -replace '<!--\s*.+?\s*-->', $new_comment
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

if ($new_entries.Count -eq 0) { exit 0 }

# Bootstrap global file if it doesn't exist yet
if (-not (Test-Path $global_path)) {
    $init = @"
# Global Skills Log

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

exit 0
