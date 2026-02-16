$env:HOME = "C:\Users\wannago"
$ErrorActionPreference = "Continue"

Write-Host "=== Running daemon directly ==="
$daemonPath = "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\cli\src\daemon.ts"
$scriptPath = "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\src\daemon.ts"

Write-Host "Checking paths..."
Write-Host "1. $daemonPath"
Write-Host "2. $scriptPath"

if (Test-Path $scriptPath) {
    Write-Host "Found daemon at: $scriptPath"
    Write-Host "Running with tsx..."
    & "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\node_modules\.bin\tsx.cmd" $scriptPath 2>&1
} else {
    Write-Host "Daemon not found at expected path"
}
