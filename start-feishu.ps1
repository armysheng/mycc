# MyCC 飞书通道启用脚本
#
# 使用方法：
# 1. 设置环境变量（或修改脚本中的值）
# 2. 运行脚本：.\start-feishu.ps1
# 3. 重启 mycc 后端
# 4. 飞书通道将自动启用

# Set encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "       MyCC 飞书通道配置" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 配置飞书环境变量
$env:FEISHU_APP_ID = "cli_a123b456c789d012"  # 替换为你的飞书应用 ID
$env:FEISHU_APP_SECRET = "abcdef1234567890"  # 替换为你的飞书应用密钥
$env:FEISHU_ENCRYPT_KEY = ""  # 可选：加密密钥
$env:FEISHU_VERIFY_TOKEN = ""  # 可选：验证令牌

Write-Host "[配置] 飞书应用信息" -ForegroundColor Yellow
Write-Host "  App ID: $env:FEISHU_APP_ID" -ForegroundColor Gray
Write-Host "  App Secret: $(if ($env:FEISHU_APP_SECRET) { '***已设置***' } else { '未设置' })" -ForegroundColor Gray
Write-Host ""

Write-Host "[说明] 飞书通道特性" -ForegroundColor Yellow
Write-Host "  - 只发送文本类型消息" -ForegroundColor Gray
Write-Host "  - 自动过滤图片、文件等非文本内容" -ForegroundColor Gray
Write-Host "  - 与 Web 通道并行工作" -ForegroundColor Gray
Write-Host ""

Write-Host "[步骤] 启用飞书通道" -ForegroundColor Yellow
Write-Host "  1. 环境变量已设置（当前会话有效）" -ForegroundColor Green
Write-Host "  2. 重启 mycc 后端以加载飞书通道" -ForegroundColor Yellow
Write-Host "  3. 后端启动时会显示：'[Channels] 飞书通道已启用'" -ForegroundColor Yellow
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：要让环境变量永久生效，请设置系统环境变量：" -ForegroundColor Gray
Write-Host "  1. 按 Win+R，输入 sysdm.cpl" -ForegroundColor Gray
Write-Host "  2. 高级 -> 环境变量" -ForegroundColor Gray
Write-Host "  3. 添加以下变量：" -ForegroundColor Gray
Write-Host "     FEISHU_APP_ID = 你的飞书应用 ID" -ForegroundColor DarkGray
Write-Host "     FEISHU_APP_SECRET = 你的飞书应用密钥" -ForegroundColor DarkGray
Write-Host ""
