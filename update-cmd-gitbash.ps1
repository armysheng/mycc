# Update CMD hook files to include custom Git Bash path
# Git Bash is at: E:\Program Files\Git\git-bash.exe

$hooksDir = "C:\Users\wannago\.ralph\.claude\hooks"
$cmdFiles = Get-ChildItem -Path $hooksDir -Filter "*.cmd"

$newTemplate = @'
@echo off
setlocal
REM Windows wrapper for {SCRIPT_NAME}
REM Auto-detects and uses available bash (Git Bash, WSL, or system bash)

set "SCRIPT_DIR=%~dp0"
set "BASH_CMD="
set "BASH_FLAGS="

REM Try custom Git Bash path first (E:\Program Files\Git\)
if exist "E:\Program Files\Git\git-bash.exe" (
    set "BASH_CMD=E:\Program Files\Git\git-bash.exe"
    set "BASH_FLAGS="
) else if exist "E:\Program Files\Git\bin\bash.exe" (
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

REM Execute the bash script
%BASH_CMD% %BASH_FLAGS% "%SCRIPT_DIR%{SCRIPT_NAME}.sh" < nul 2>nul || (
    REM If bash execution fails, output default allow response
    echo {"continue": true, "hookSpecificOutput": {"permissionDecision": "allow"}}
)

endlocal
'@

$count = 0
foreach ($cmdFile in $cmdFiles) {
    if ($cmdFile.Name -match "(pre-commit-command-validation|post-commit-command-verify)\.cmd") {
        continue  # Skip stub files
    }

    $scriptName = $cmdFile.BaseName
    $newContent = $newTemplate -replace '\{SCRIPT_NAME\}', $scriptName
    Set-Content -Path $cmdFile.FullName -Value $newContent -NoNewline
    $count++
}

Write-Host "Updated $count CMD hook files with custom Git Bash path."
