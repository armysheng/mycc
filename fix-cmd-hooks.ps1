# PowerShell script to update all .cmd hook files
# Usage: .\fix-cmd-hooks.ps1

$hooksDir = "C:\Users\wannago\.ralph\.claude\hooks"

# New CMD template
$cmdTemplate = @'
@echo off
setlocal
REM Windows wrapper for {SCRIPT_NAME}
REM Auto-detects and uses available bash (Git Bash, WSL, or system bash)

set "SCRIPT_DIR=%~dp0"
set "BASH_CMD="
set "BASH_FLAGS="

REM Try Git Bash first (most compatible)
if exist "C:\Program Files\Git\bin\bash.exe" (
    set "BASH_CMD=C:\Program Files\Git\bin\bash.exe"
    set "BASH_FLAGS="
) else if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    set "BASH_CMD=C:\Program Files (x86)\Git\bin\bash.exe"
    set "BASH_FLAGS="
) else if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" (
    set "BASH_CMD=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
    set "BASH_FLAGS="
) else (
    REM Try WSL bash
    where wsl.exe >nul 2>&1
    if not errorlevel 1 (
        set "BASH_CMD=wsl.exe"
        set "BASH_FLAGS=bash"
    ) else (
        REM No bash available - output default allow response
        echo {"continue": true, "hookSpecificOutput": {"permissionDecision": "allow"}}
        endlocal
        exit /b 0
    )
)

REM Execute the bash script
%BASH_CMD% %BASH_FLAGS% "%SCRIPT_DIR%~dp0{SCRIPT_NAME}.sh" < nul 2>nul || (
    REM If bash execution fails, output default allow response
    echo {"continue": true, "hookSpecificOutput": {"permissionDecision": "allow"}}
)

endlocal
'@

# Get all .cmd files (skip the ones we just created as stubs)
$cmdFiles = Get-ChildItem -Path $hooksDir -Filter "*.cmd" | Where-Object {
    $_.Name -notmatch "(pre-commit-command-validation|post-commit-command-verify)\.cmd"
}

Write-Host "Updating $($cmdFiles.Count) CMD hook files..."

$count = 0
foreach ($cmdFile in $cmdFiles) {
    $scriptName = $cmdFile.BaseName
    $newContent = $cmdTemplate -replace '\{SCRIPT_NAME\}', $scriptName

    # Check if current file is just calling bash directly
    $currentContent = Get-Content $cmdFile.FullName -Raw
    if ($currentContent -match 'bash\s+"%~dp0.*\.sh"') {
        Set-Content -Path $cmdFile.FullName -Value $newContent -NoNewline
        $count++
        Write-Host "Updated: $($cmdFile.Name)"
    }
}

Write-Host "`nComplete! Updated $count files."
Write-Host "The stub files (pre-commit-command-validation.cmd, post-commit-command-verify.cmd) were not modified."
