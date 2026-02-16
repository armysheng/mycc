# MyCC 全服务启动脚本
#
# 启动 mycc 后端（Web + 飞书双通道）

# Set encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$PROJECT_DIR = "E:\AI\mycc\AImycc"
$SCRIPT_DIR = "$PROJECT_DIR\.claude\skills\mycc\scripts"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MyCC 后端启动" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 检查飞书配置
$feishuEnabled = $env:FEISHU_APP_ID -and $env:FEISHU_APP_SECRET

if ($feishuEnabled) {
    Write-Host "[✓] 飞书通道已配置" -ForegroundColor Green
    Write-Host "  App ID: $env:FEISHU_APP_ID" -ForegroundColor Gray
} else {
    Write-Host "[ ] 飞书通道未配置（可选）" -ForegroundColor Yellow
    Write-Host "  运行 .\start-feishu.ps1 配置飞书" -ForegroundColor Gray
}

Write-Host ""

# 启动后端
Write-Host "[启动] mycc 后端..." -ForegroundColor Yellow
Write-Host ""

# 使用 tsx 启动
Set-Location $SCRIPT_DIR
& node_modules/.bin/tsx src/index.ts start

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor Gray
Write-Host "  - Web 通道: http://localhost:18080" -ForegroundColor DarkGray
Write-Host "  - 飞书通道: $($feishuEnabled ? '已启用' : '未配置')" -ForegroundColor DarkGray
Write-Host ""
Write-Host "停止服务：" -ForegroundColor Gray
Write-Host "  .\stop-mycc.ps1" -ForegroundColor DarkGray
Write-Host ""
