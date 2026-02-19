#!/bin/bash
# 将模板文件同步到 VPS
set -e

VPS_HOST="${1:-armysheng@34.104.162.57}"
TEMPLATE_DIR="$(dirname "$0")/../templates/user-workspace"
REMOTE_DIR="/opt/mycc/templates/user-workspace"

echo "=== 部署模板到 ${VPS_HOST} ==="

# 创建远程目录
ssh "$VPS_HOST" "sudo mkdir -p $REMOTE_DIR"

# 优先使用 rsync（更快），否则回退到 tar 管道（兼容最小化系统）
if ssh "$VPS_HOST" "command -v rsync >/dev/null 2>&1"; then
  # 同步文件（需要 sudo 权限写入 /opt）
  rsync -avz --delete --rsync-path="sudo rsync" "$TEMPLATE_DIR/" "$VPS_HOST:$REMOTE_DIR/"
else
  echo "⚠️ 远程未安装 rsync，使用 tar 管道同步"
  ssh "$VPS_HOST" "sudo rm -rf $REMOTE_DIR/*"
  COPYFILE_DISABLE=1 tar -C "$TEMPLATE_DIR" -czf - . | ssh "$VPS_HOST" "sudo tar -xzf - -C $REMOTE_DIR"
fi

# 设置权限
ssh "$VPS_HOST" "sudo chmod -R 755 $REMOTE_DIR"

echo "✅ 模板部署完成"
