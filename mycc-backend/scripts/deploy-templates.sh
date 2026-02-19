#!/bin/bash
# 将模板文件同步到 VPS
set -e

VPS_HOST="${1:-armysheng@34.104.162.57}"
TEMPLATE_DIR="$(dirname "$0")/../templates/user-workspace"
REMOTE_DIR="/opt/mycc/templates/user-workspace"

echo "=== 部署模板到 ${VPS_HOST} ==="

# 创建远程目录
ssh "$VPS_HOST" "sudo mkdir -p $REMOTE_DIR"

# 同步文件（需要 sudo 权限写入 /opt）
rsync -avz --delete --rsync-path="sudo rsync" "$TEMPLATE_DIR/" "$VPS_HOST:$REMOTE_DIR/"

# 设置权限
ssh "$VPS_HOST" "sudo chmod -R 755 $REMOTE_DIR"

echo "✅ 模板部署完成"
