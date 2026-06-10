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

# Infer project name: parent of the docs/ folder
$normalized = $file_path -replace '\\', '/'
$parts = $normalized -split '/'
$project_name = 'unknown-project'
for ($i = $parts.Length - 1; $i -ge 0; $i--) {
    if ($parts[$i] -eq 'docs' -and $i -gt 0) {
        $project_name = $parts[$i - 1]
        break
    }
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

# Global skills file
$global_path = Join-Path $env:USERPROFILE '.claude\global-skills.md'

$global_content = ''
if (Test-Path $global_path) {
    $global_content = Get-Content $global_path -Raw -Encoding UTF8
}

# Filter to entries whose header doesn't yet exist in global log.
# Dedup on bare title+date only (strip any existing <!-- --> comment before checking)
# so project renames don't create duplicates — same lesson is same lesson.
$new_entries = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $entries) {
    $header = ($entry -split "`n")[0].Trim()
    $bare_header = $header -replace '\s*<!--.*-->$', ''
    if ($global_content -notmatch [regex]::Escape($bare_header)) {
        $new_entries.Add($entry)
    }
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

    # Insert **Project:** line after the header
    $attribution   = "**Project:** ``$project_name``"
    $body          = $rest_lines -join "`n"

    $full_entry    = "`n" + $tagged_header + "`n`n" + $attribution + "`n" + $body.TrimStart("`n")
    Add-Content $global_path $full_entry -Encoding UTF8
}

exit 0
