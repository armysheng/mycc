$env:HOME = "C:\Users\wannago"
$env:AGENT_BROWSER_DISABLE_NATIVE = "1"

Write-Host "=== Testing with native binary disabled ==="
Write-Host "HOME: $env:HOME"
Write-Host "DISABLE_NATIVE: $env:AGENT_BROWSER_DISABLE_NATIVE"

$cliPath = "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\bin\agent-browser.js"

& node $cliPath open example.com 2>&1
