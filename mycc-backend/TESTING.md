# 本地测试指南

## 快速开始

### 1. 启动开发环境

```bash
cd mycc-backend

# 启动 Docker 服务（PostgreSQL）
docker-compose up -d

# 等待数据库就绪
sleep 5

# 安装依赖（如果还没安装）
npm install

# 创建 .env 文件
cp .env.example .env
```

### 2. 配置环境变量

编辑 `.env` 文件：

```bash
# 数据库（Docker 默认配置）
DATABASE_URL=postgresql://mycc:mycc_dev_password@localhost:5432/mycc_dev

# JWT 密钥（开发环境可以用简单的）
JWT_SECRET=dev_secret_key_for_testing

# 服务器配置
PORT=8080
NODE_ENV=development

# Claude API（可选，如果要测试对话功能）
ANTHROPIC_API_KEY=sk-ant-your-api-key

# 套餐配置
PLAN_FREE_TOKENS=10000
PLAN_BASIC_TOKENS=100000
PLAN_PRO_TOKENS=500000

# 并发限制
MAX_CONCURRENT_USERS=20
MAX_CONCURRENT_PER_USER=1
```

### 3. 启动后端服务

```bash
# 开发模式（热重载）
npm run dev
```

你应该看到：
```
✅ 数据库连接成功
🚀 服务器启动成功: http://0.0.0.0:8080
📊 健康检查: http://0.0.0.0:8080/health
```

### 4. 测试 API

打开新终端，运行测试脚本：

```bash
cd mycc-backend
./test-api.sh
```

或者手动测试：

```bash
# 1. 健康检查
curl http://localhost:8080/health

# 2. 注册用户
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+8613800138000",
    "password": "test123456",
    "nickname": "测试用户"
  }'

# 保存返回的 token
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 3. 获取用户信息
curl http://localhost:8080/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# 4. 获取订阅信息
curl http://localhost:8080/api/billing/subscription \
  -H "Authorization: Bearer $TOKEN"

# 5. 发送消息（需要配置 ANTHROPIC_API_KEY）
curl -X POST http://localhost:8080/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，请用一句话介绍你自己"
  }'
```

## 测试场景

### 场景 1: 用户注册和登录

```bash
# 注册
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone": "+8613800138001", "password": "test123", "nickname": "用户1"}'

# 登录
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"credential": "+8613800138001", "password": "test123"}'
```

### 场景 2: 对话功能（需要 Claude API）

```bash
# 发送消息
curl -X POST http://localhost:8080/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "写一个 Hello World"}'

# 查看会话列表
curl http://localhost:8080/api/chat/sessions \
  -H "Authorization: Bearer $TOKEN"

# 重命名会话
curl -X POST http://localhost:8080/api/chat/sessions/SESSION_ID/rename \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newTitle": "Hello World 示例"}'

# 查看文件化 identity/soul 状态
curl http://localhost:8080/api/chat/identity \
  -H "Authorization: Bearer $TOKEN"

# 写入长期记忆（MEMORY.md）
curl -X PUT http://localhost:8080/api/chat/memory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"偏好：先给结论，再给细节。"}'

# 读取长期记忆
curl http://localhost:8080/api/chat/memory \
  -H "Authorization: Bearer $TOKEN"
```

### 场景 2.1: Session Soul 一键 E2E

```bash
cd mycc-backend
./scripts/e2e-session-soul.sh
```

### 场景 3: 计费和额度

```bash
# 查看订阅信息
curl http://localhost:8080/api/billing/subscription \
  -H "Authorization: Bearer $TOKEN"

# 查看使用统计
curl http://localhost:8080/api/billing/usage \
  -H "Authorization: Bearer $TOKEN"

# 升级套餐
curl -X POST http://localhost:8080/api/billing/upgrade \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan": "basic"}'
```

## 查看数据库

```bash
# 连接数据库
docker-compose exec postgres psql -U mycc -d mycc_dev

# 查看用户
SELECT id, phone, nickname, linux_user, status FROM users;

# 查看订阅
SELECT user_id, plan, tokens_limit, tokens_used FROM subscriptions;

# 查看使用记录
SELECT user_id, session_id, input_tokens, output_tokens, model, created_at
FROM usage_logs
ORDER BY created_at DESC
LIMIT 10;

# 退出
\q
```

## 常见问题

### 数据库连接失败

```bash
# 检查 Docker 是否运行
docker ps

# 重启 Docker 服务
docker-compose down
docker-compose up -d

# 查看日志
docker-compose logs postgres
```

### 端口被占用

```bash
# 查看占用端口的进程
lsof -i :8080

# 杀死进程
kill -9 <PID>

# 或者修改 .env 中的 PORT
```

### Claude CLI 未安装

对话功能需要 Claude CLI：

```bash
# 安装 Claude CLI
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version
```

### 重置数据库

```bash
# 停止并删除所有数据
docker-compose down -v

# 重新启动（会自动初始化）
docker-compose up -d
```

## 开发工作流

1. **修改代码** - 编辑 `src/` 目录下的文件
2. **自动重载** - `npm run dev` 会自动检测变化并重启
3. **测试 API** - 使用 `curl` 或 Postman 测试
4. **查看日志** - 终端会显示实时日志
5. **调试数据库** - 使用 `docker-compose exec postgres psql`

## 下一步

- ✅ 后端 API 已完成
- ⏳ 前端 UI 改造（Phase 6）
- ⏳ 集成测试
- ⏳ 性能测试

## 技术栈总结

**后端**:
- TypeScript + Node.js
- Fastify（HTTP 框架）
- PostgreSQL（数据库）
- JWT（认证）
- Docker（开发环境）

**核心功能**:
- ✅ 用户注册/登录
- ✅ JWT 认证
- ✅ 多用户隔离（开发环境用目录模拟）
- ✅ 对话接口（SSE 流式响应）
- ✅ 使用量统计
- ✅ 套餐管理
- ✅ 并发控制
