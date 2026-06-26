#!/bin/bash
# 生产环境部署脚本

set -e

echo "=== MyCC Backend 生产环境部署 ==="

NODE_BIN_DIR="${MYCC_NODE_BIN_DIR:-/home/armysheng/.local/node-v20.19.5-linux-x64/bin}"
NODE_BIN="$NODE_BIN_DIR/node"
NPM_BIN="$NODE_BIN_DIR/npm"

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请使用 root 权限运行此脚本"
  exit 1
fi

# 1. 安装系统依赖
echo "📦 安装系统依赖..."
apt update
apt install -y postgresql redis-server sudo

echo "📦 校验生产 Node 工具链..."
if [ ! -x "$NODE_BIN" ] || [ ! -x "$NPM_BIN" ]; then
  echo "❌ 未找到生产 Node v20.19.5: $NODE_BIN_DIR"
  echo "请先安装 Node 到该目录，或通过 MYCC_NODE_BIN_DIR 指定服务 Node bin 目录。"
  exit 1
fi
"$NODE_BIN" -v | grep -qx "v20.19.5" || {
  echo "❌ $NODE_BIN 不是 v20.19.5"
  "$NODE_BIN" -v || true
  exit 1
}
echo "✅ Node $("$NODE_BIN" -v), npm $("$NPM_BIN" -v)"

# 2. 创建服务账号
echo "👤 创建服务账号..."
if ! id -u mycc_service > /dev/null 2>&1; then
  useradd -m -d /home/mycc_service -s /bin/bash mycc_service
  echo "✅ 创建服务账号: mycc_service"
else
  echo "⚠️  服务账号已存在"
fi

# 3. 配置 sudo 权限（允许 mycc_service 切换到 mycc_u* 用户）
echo "🔐 配置 sudo 权限..."
cat > /etc/sudoers.d/mycc <<EOF
mycc_service ALL=(mycc_u*) NOPASSWD: ALL
EOF
chmod 440 /etc/sudoers.d/mycc
echo "✅ sudo 权限配置完成"

# 4. 配置资源限制
echo "⚙️  配置资源限制..."
cat >> /etc/security/limits.conf <<EOF
# MyCC 用户资源限制
mycc_u* soft nproc 100
mycc_u* hard nproc 200
mycc_u* soft nofile 1024
mycc_u* hard nofile 2048
mycc_u* soft cpu 30
mycc_u* hard cpu 60
EOF
echo "✅ 资源限制配置完成"

# 5. 初始化数据库
echo "🗄️  初始化数据库..."
sudo -u postgres psql <<EOF
CREATE DATABASE mycc_production;
CREATE USER mycc_user WITH PASSWORD 'CHANGE_THIS_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE mycc_production TO mycc_user;
EOF

# 导入 schema
sudo -u postgres psql -d mycc_production -f /home/mycc_service/mycc/mycc-backend/db/schema.sql
echo "✅ 数据库初始化完成"

# 6. 配置 systemd 服务
echo "🚀 配置 systemd 服务..."
cat > /etc/systemd/system/mycc-backend.service <<EOF
[Unit]
Description=MyCC Backend Service
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=mycc_service
WorkingDirectory=/home/mycc_service/mycc/mycc-backend
ExecStart=$NODE_BIN dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PATH=$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 资源限制
LimitNOFILE=4096
LimitNPROC=512

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mycc-backend
echo "✅ systemd 服务配置完成"

# 7. 配置防火墙
echo "🔥 配置防火墙..."
if command -v ufw > /dev/null; then
  ufw allow 8080/tcp
  ufw allow 22/tcp
  echo "✅ 防火墙配置完成"
else
  echo "⚠️  未检测到 ufw，跳过防火墙配置"
fi

echo ""
echo "✅ 生产环境部署完成！"
echo ""
echo "下一步："
echo "  1. 编辑 /home/mycc_service/mycc/mycc-backend/.env"
echo "  2. 设置数据库密码和 API 密钥"
echo "  3. 运行 'systemctl start mycc-backend'"
echo "  4. 查看日志 'journalctl -u mycc-backend -f'"
