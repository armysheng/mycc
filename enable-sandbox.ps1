# Windows Sandbox 启用脚本
# 请右键点击此文件，选择"以管理员身份运行"

Write-Host "正在启用 Windows Sandbox..." -ForegroundColor Green

# 启用 Windows Sandbox 功能
Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClientVM" -All -NoRestart

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Windows Sandbox 已准备启用！" -ForegroundColor Green
Write-Host ""
Write-Host "接下来需要：" -ForegroundColor Yellow
Write-Host "1. 重启电脑以完成安装" -ForegroundColor White
Write-Host "2. 重启后继续运行后续配置脚本" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Yellow

# 询问是否立即重启
$restart = Read-Host "是否立即重启电脑？(Y/N)"
if ($restart -eq "Y" -or $restart -eq "y") {
    Restart-Computer
}
