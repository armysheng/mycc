#!/bin/bash
# VPS 快速部署脚本（测试环境）

set -e

echo "=== MyCC VPS 快速部署（测试环境）==="

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请使用 root 权限运行"
  exit 1
fi

# 1. 更新系统
echo "📦 更新系统..."
apt update && apt upgrade -y

# 2. 安装 Node.js 22
echo "📦 安装 Node.js..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
echo "✅ Node.js $(node --version)"

# 3. 安装 PostgreSQL
echo "📦 安装 PostgreSQL..."
if ! command -v psql &> /dev/null; then
  apt install -y postgresql postgresql-contrib
fi
echo "✅ PostgreSQL 已安装"

# 4. 安装 PM2
echo "📦 安装 PM2..."
npm install -g pm2

# 5. 克隆项目（如果还没有）
if [ ! -d "/root/mycc" ]; then
  echo "📦 克隆项目..."
  cd /root
  git clone https://github.com/Aster110/mycc.git
fi

cd /root/mycc/mycc-backend

# 6. 安装依赖
echo "📦 安装依赖..."
npm install

# 7. 配置数据库
echo "🗄️  配置数据库..."
sudo -u postgres psql <<EOF || echo "数据库可能已存在"
CREATE DATABASE mycc_test;
CREATE USER mycc WITH PASSWORD 'test_password_123';
GRANT ALL PRIVILEGES ON DATABASE mycc_test TO mycc;
EOF

# 导入 schema
sudo -u postgres psql -d mycc_test -f db/schema.sql 2>/dev/null || echo "Schema 可能已导入"

# 8. 配置环境变量
echo "⚙️  配置环境变量..."
cat > .env <<EOF
DATABASE_URL=postgresql://mycc:test_password_123@localhost:5432/mycc_test
JWT_SECRET=$(openssl rand -base64 32)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-sk-ant-your-api-key}
PORT=8080
NODE_ENV=production
PLAN_FREE_TOKENS=300000
PLAN_BASIC_TOKENS=3000000
PLAN_PRO_TOKENS=12000000
PLAN_BASIC_PRICE_CNY=39
PLAN_PRO_PRICE_CNY=99
MAX_CONCURRENT_USERS=20
MAX_CONCURRENT_PER_USER=1
EOF

echo "⚠️  请编辑 .env 文件设置 ANTHROPIC_API_KEY"

# 9. 构建
echo "🔨 构建项目..."
npm run build

# 10. 配置防火墙
echo "🔥 配置防火墙..."
ufw allow 22/tcp
ufw allow 8080/tcp
echo "y" | ufw enable || true

# 11. 启动服务
echo "🚀 启动服务..."
pm2 delete mycc-backend 2>/dev/null || true
pm2 start dist/index.js --name mycc-backend
pm2 save
pm2 startup | tail -1 | bash || true

# 12. 获取服务器 IP
SERVER_IP=$(curl -s ifconfig.me)

echo ""
echo "✅ 部署完成！"
echo ""
echo "服务器信息："
echo "  IP: $SERVER_IP"
echo "  端口: 8080"
echo "  健康检查: http://$SERVER_IP:8080/health"
echo ""
echo "下一步："
echo "  1. 编辑 /root/mycc/mycc-backend/.env 设置 ANTHROPIC_API_KEY"
echo "  2. 重启服务: pm2 restart mycc-backend"
echo "  3. 查看日志: pm2 logs mycc-backend"
echo "  4. 测试 API: curl http://$SERVER_IP:8080/health"
