# Fix CMD hook files - properly handle paths with spaces
# Use a helper batch file to execute bash with proper quoting

$hooksDir = "C:\Users\wannago\.ralph\.claude\hooks"

# New approach: use call with proper quoting
$newTemplate = @'
@echo off
setlocal
REM Windows wrapper for {SCRIPT_NAME}
REM Auto-detects and uses available bash (Git Bash, WSL, or system bash)

set "SCRIPT_DIR=%~dp0"
set "BASH_CMD="
set "BASH_FLAGS="

REM Try E:\Program Files\Git\ first (custom location)
if exist "E:\Program Files\Git\bin\bash.exe" (
    set "BASH_CMD=E:\Program Files\Git\bin\bash.exe"
    set "BASH_FLAGS="
) else if exist "C:\Program Files\Git\bin\bash.exe" (
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

REM Execute the bash script using call (properly handles quoted paths with spaces)
call "%BASH_CMD%" %BASH_FLAGS% "%SCRIPT_DIR%{SCRIPT_NAME}.sh" 2>nul
if errorlevel 1 (
    echo {"continue": true, "hookSpecificOutput": {"permissionDecision": "allow"}}
)

endlocal
'@

$cmdFiles = Get-ChildItem -Path $hooksDir -Filter "*.cmd" | Where-Object {
    $_.Name -notmatch "(pre-commit-command-validation|post-commit-command-verify|test-debug)\.cmd"
}

$count = 0
foreach ($cmdFile in $cmdFiles) {
    $scriptName = $cmdFile.BaseName
    $newContent = $newTemplate -replace '\{SCRIPT_NAME\}', $scriptName
    Set-Content -Path $cmdFile.FullName -Value $newContent -NoNewline
    $count++
}

Write-Host "Fixed $count CMD hook files - added 'call' for proper path handling."
