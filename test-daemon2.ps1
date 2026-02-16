$env:HOME = "C:\Users\wannago"
$env:DEBUG = "*"

Write-Host "=== Running daemon.js directly ==="
$daemonPath = "C:\Users\wannago\AppData\Roaming\npm\node_modules\agent-browser\dist\daemon.js"

& node $daemonPath 2>&1
