# agent-browser 测试脚本
# 测试 agent-browser 在 Windows 环境下的功能

# 设置环境变量（可选）
$env:HOME = "C:\Users\wannago"
# $env:DEBUG = "pw:*"  # 启用调试模式（需要时取消注释）

Write-Host "=== agent-browser 测试 ===" -ForegroundColor Green
Write-Host ""

# 测试 1: 检查版本
Write-Host "[1/4] 检查 agent-browser 版本..." -ForegroundColor Yellow
agent-browser --version
Write-Host ""

# 测试 2: 打开测试页面
Write-Host "[2/4] 打开 example.com..." -ForegroundColor Yellow
agent-browser open https://example.com
Start-Sleep -Seconds 2
Write-Host ""

# 测试 3: 获取页面信息
Write-Host "[3/4] 获取页面标题..." -ForegroundColor Yellow
$title = agent-browser get title
Write-Host "页面标题: $title" -ForegroundColor Cyan
Write-Host ""

# 测试 4: 百度搜索（中文支持）
Write-Host "[4/4] 测试中文搜索..." -ForegroundColor Yellow
agent-browser open "https://www.baidu.com/s?wd=无线自组网"
Start-Sleep -Seconds 3
$baiduTitle = agent-browser get title
Write-Host "百度搜索标题: $baiduTitle" -ForegroundColor Cyan
Write-Host ""

Write-Host "=== 测试完成 ===" -ForegroundColor Green
Write-Host ""
Write-Host "提示: 所有命令必须在 PowerShell 中运行，不要在 Git Bash 中运行" -ForegroundColor Yellow
