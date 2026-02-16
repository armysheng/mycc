# MyCC 后端启动脚本（带飞书通道）
#
# 自动配置飞书凭证并启动后端

# 设置编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 飞书凭证配置
$env:FEISHU_APP_ID = "cli_a90eea90c5229bc2"
$env:FEISHU_APP_SECRET = "w4QG74AVY2U55GhCmDeRVgCw21kPZRui"
$env:FEISHU_RECEIVE_USER_ID = "oc_50e9e337f9d84fe1fc2b5b9f95073f2d"
$env:FEISHU_RECEIVE_ID_TYPE = "chat_id"  # 群聊 ID
$env:FEISHU_CONNECTION_MODE = "websocket"  # 使用 WebSocket 长连接接收消息

$PROJECT_DIR = "E:\AI\mycc\AImycc"
$SCRIPT_DIR = "$PROJECT_DIR\.claude\skills\mycc\scripts"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MyCC + 飞书通道" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 显示飞书配置
Write-Host "[飞书配置]" -ForegroundColor Yellow
Write-Host "  App ID: $env:FEISHU_APP_ID" -ForegroundColor Gray
Write-Host "  企业 ID: ww6ce40c10b0b83871" -ForegroundColor Gray
Write-Host ""

# 启动后端
Write-Host "[启动] mycc 后端..." -ForegroundColor Yellow
Write-Host ""

Set-Location $SCRIPT_DIR
& node_modules/.bin/tsx src/index.ts start
