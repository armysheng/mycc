# PowerShell script to fix the path issue in CMD hook files
# The SCRIPT_DIR variable already includes ~dp0, so we shouldn't duplicate it

$hooksDir = "C:\Users\wannago\.ralph\.claude\hooks"
$cmdFiles = Get-ChildItem -Path $hooksDir -Filter "*.cmd" | Where-Object {
    $_.Name -notmatch "(pre-commit-command-validation|post-commit-command-verify)\.cmd"
}

$count = 0
foreach ($cmdFile in $cmdFiles) {
    $content = Get-Content $cmdFile.FullName -Raw
    $scriptName = $cmdFile.BaseName

    # Fix the duplicate path issue
    $oldLine = '%BASH_CMD% %BASH_FLAGS% "%SCRIPT_DIR%~dp0' + $scriptName + '.sh"'
    $newLine = '%BASH_CMD% %BASH_FLAGS% "%SCRIPT_DIR%' + $scriptName + '.sh"'

    if ($content -match [regex]::Escape($oldLine)) {
        $newContent = $content -replace [regex]::Escape($oldLine), $newLine
        Set-Content -Path $cmdFile.FullName -Value $newContent -NoNewline
        $count++
        Write-Host "Fixed: $($cmdFile.Name)"
    }
}

Write-Host "`nComplete! Fixed $count files."
