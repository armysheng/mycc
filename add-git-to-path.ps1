# Add Git Bash to user PATH
$gitBinPath = "E:\Program Files\Git\bin"

# Get current user PATH
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')

# Check if already in PATH
if ($currentPath -like "*$gitBinPath*") {
    Write-Host "Git Bash is already in PATH" -ForegroundColor Green
    exit 0
}

# Add to beginning of PATH
$newPath = "$gitBinPath;$currentPath"

# Set new PATH
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')

Write-Host "Added $gitBinPath to user PATH" -ForegroundColor Green
Write-Host "Please restart your terminal or applications for changes to take effect." -ForegroundColor Yellow
