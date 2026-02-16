$env:HOME = "C:\Users\wannago"
$ErrorActionPreference = "Continue"

Write-Host "=== Testing agent-browser via Node.js ==="
Write-Host "HOME: $env:HOME"

$cliPath = "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\dist\cli.js"

if (Test-Path $cliPath) {
    Write-Host "Found CLI at: $cliPath"
    Write-Host "Running: open example.com"
    & node $cliPath open example.com 2>&1
} else {
    Write-Host "CLI not found"
}
