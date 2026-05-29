# MyCC Backend

MyCC 商业化后端服务

## 快速开始

### 1. 启动开发环境

```bash
# 方式一：使用自动化脚本（推荐）
./dev-setup.sh

# 方式二：手动启动
docker-compose up -d
npm install
cp .env.example .env
# 编辑 .env 设置 ANTHROPIC_API_KEY
npm run dev
```

### 2. 验证服务

```bash
# 健康检查
curl http://localhost:8080/health

# 注册用户
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone": "+8613800138000", "password": "test123", "nickname": "测试用户"}'

# 登录
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"credential": "+8613800138000", "password": "test123"}'
```

## 项目结构

```
mycc-backend/
├── db/
│   └── schema.sql          # 数据库表结构
├── src/
│   ├── db/
│   │   └── client.ts       # 数据库客户端
│   ├── auth/
│   │   └── service.ts      # 认证服务
│   ├── routes/
│   │   └── auth.ts         # 认证接口
│   ├── middleware/
│   │   └── jwt.ts          # JWT 认证中间件
│   └── index.ts            # 入口文件
├── scripts/                # 脚本文件
├── tests/                  # 测试文件
├── docker-compose.yml      # Docker 配置
├── dev-setup.sh            # 开发环境启动脚本
└── package.json
```

## 技术栈

- **TypeScript + Node.js** - 类型安全
- **Fastify** - 高性能 HTTP 框架
- **PostgreSQL** - 关系型数据库
- **JWT** - 用户认证
- **bcrypt** - 密码加密
- **Zod** - 数据验证

## API 文档

### 认证接口

#### POST /api/auth/register
注册新用户

**请求体**:
```json
{
  "phone": "+8613800138000",  // 可选，与 email 二选一
  "email": "user@example.com", // 可选，与 phone 二选一
  "password": "password123",   // 必填，至少 6 位
  "nickname": "用户昵称"        // 可选
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "phone": "+8613800138000",
      "nickname": "用户昵称",
      "linux_user": "mycc_u1",
      "plan": "free"
    }
  }
}
```

#### POST /api/auth/login
用户登录

**请求体**:
```json
{
  "credential": "+8613800138000",  // 手机号或邮箱
  "password": "password123"
}
```

**响应**: 同注册接口

#### GET /api/auth/me
获取当前用户信息（需要认证）

**请求头**:
```
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "phone": "+8613800138000",
    "nickname": "用户昵称",
    "linux_user": "mycc_u1",
    "status": "active",
    "subscription": {
      "plan": "free",
      "tokens_limit": 10000,
      "tokens_used": 1234,
      "tokens_remaining": 8766,
      "reset_at": "2026-03-01T00:00:00Z"
    }
  }
}
```

## 环境变量

参考 `.env.example` 配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| DATABASE_URL | PostgreSQL 连接字符串 | - |
| REDIS_URL | Redis 连接字符串（可选） | - |
| JWT_SECRET | JWT 签名密钥 | - |
| ANTHROPIC_API_KEY | Claude API 密钥 | - |
| PORT | 服务端口 | 8080 |
| NODE_ENV | 运行环境 | development |
| PLAN_FREE_TOKENS | 免费版额度 | 300000 |
| PLAN_BASIC_TOKENS | 基础版额度 | 3000000 |
| PLAN_PRO_TOKENS | 专业版额度 | 12000000 |
| PLAN_BASIC_PRICE_CNY | 基础版月费（人民币） | 39 |
| PLAN_PRO_PRICE_CNY | 专业版月费（人民币） | 99 |
| MYCC_AGENT_RUNTIME | Agent 运行时：`remote-claude` 或 `claude-agent-sdk` | remote-claude |
| MYCC_AGENT_SDK_BASE_URL | Agent SDK 的 Anthropic/CCR base URL | - |
| MYCC_AGENT_SDK_AUTH_TOKEN | Agent SDK/CCR auth token | - |
| MYCC_AGENT_SDK_API_KEY | Agent SDK Anthropic API key | ANTHROPIC_API_KEY |
| MYCC_AGENT_SDK_MODEL | Agent SDK 默认模型 | claude-sonnet-4-6 |
| MYCC_AGENT_SDK_ALLOWED_TOOLS | Agent SDK 自动允许工具，逗号分隔 | Read,Glob,Grep |
| MYCC_AGENT_SDK_PERMISSION_MODE | Agent SDK 权限模式 | dontAsk |
| MYCC_AGENT_SDK_PARTIAL_MESSAGES | 是否输出 SDK partial stream event | false |
| MYCC_AGENT_SDK_CONFIG_ROOT | Agent SDK 每用户 HOME/Claude 配置根目录；为空时使用 `/home/{linux_user}/.mycc` | - |
| MYCC_IDE_PROVIDER | Remote IDE provider：`disabled` 或 `e2b` | disabled |
| MYCC_IDE_PORT | code-server 在沙箱内监听的端口 | 18080 |
| MYCC_IDE_SESSION_TTL_SECONDS | IDE sandbox/session 默认 TTL | 3600 |
| MYCC_E2B_API_KEY | E2B API key，后续真实 provider 使用 | - |
| MYCC_E2B_TEMPLATE | E2B code-server 模板名 | mycc-code-server-dev |
| MYCC_E2B_ALLOW_PUBLIC_TRAFFIC | 是否允许 E2B host 直接公网访问；产品路径必须为 false | false |

### Agent Runtime

后端聊天和自动化都通过 `src/agent-runtime` 工厂创建运行时，方便逐步接入不同底层：

- `remote-claude`：默认稳定路径，保持现有行为，通过 SSH 在 VPS 用户工作区执行 `claude --print --output-format stream-json`。
- `claude-agent-sdk`：实验路径，使用官方 `@anthropic-ai/claude-agent-sdk` 在当前服务环境中启动 Claude Code agent。默认 `settingSources: []`、`permissionMode: dontAsk`、`allowedTools: Read,Glob,Grep`，并强制 cwd 落在 `/home/{linux_user}/workspace` 下，避免多租户场景下误读本机 Claude 配置或默认放开高风险工具。

`claude-agent-sdk` runtime 会覆盖传给 SDK 子进程的 `HOME`、`CLAUDE_CONFIG_DIR`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`。默认每个用户写到 `/home/{linux_user}/.mycc`；如果运行在 E2B/容器沙箱或希望挂载专用 runtime 卷，可设置 `MYCC_AGENT_SDK_CONFIG_ROOT=/srv/mycc/runtime`，最终目录为 `/srv/mycc/runtime/{linux_user}/{home,.claude}`。

如果要让 Agent SDK 通过 ccr router 转换/路由模型，可先启动 ccr，再配置：

```bash
MYCC_AGENT_RUNTIME=claude-agent-sdk
MYCC_AGENT_SDK_BASE_URL=http://127.0.0.1:3456
MYCC_AGENT_SDK_AUTH_TOKEN=<ccr-api-key-or-token>
MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep
MYCC_AGENT_SDK_PERMISSION_MODE=dontAsk
```

注意：`claude-agent-sdk` runtime 当前是 opt-in 实验能力，适合沙箱/单用户隔离环境验证；生产多用户默认仍使用 `remote-claude`。

### Remote IDE / code-server POC

后端已预留 `/api/ide/config`、`/api/ide/sessions/plan`、`POST /api/ide/sessions` 和 `/api/ide/sessions/:id/status`，用于下一阶段接 E2B sandbox + code-server。默认 `MYCC_IDE_PROVIDER=disabled`，不会创建 sandbox；设置为 `e2b` 后会生成 proxy-only session plan，并可通过 `E2bSandboxProvider` 创建 POC 会话。当前响应会隐藏 E2B host 与 traffic token，等待反向代理层接入。

```bash
MYCC_IDE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-code-server-dev
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
```

安全默认值是：code-server 只作为 mycc 反向代理后的能力暴露，沙箱内部固定端口 `18080`，启动命令使用 `--auth none` 但必须配合 `E2B allowPublicTraffic:false + mycc 一次性访问 token + 后端注入 e2b-traffic-access-token`。不要把 E2B public host 或裸 code-server password 页面直接给产品用户。

## 开发说明

### 本地开发 vs 生产环境

**本地开发**:
- 使用 Docker 容器运行数据库
- 不创建真实 Linux 用户，用目录隔离模拟
- 工作目录：`/tmp/mycc_dev/{linux_user}/workspace`

**生产环境**:
- 独立的数据库服务器
- 真实的 Linux 用户隔离（`useradd`）
- 工作目录：`/home/{linux_user}/workspace`

### 常用命令

```bash
# 开发
npm run dev          # 启动开发服务器（热重载）
npm run build        # 编译 TypeScript
npm start            # 启动生产服务器

# Docker
docker-compose up -d      # 启动服务
docker-compose down       # 停止服务
docker-compose logs -f    # 查看日志
docker-compose down -v    # 停止并删除数据

# 数据库
docker-compose exec postgres psql -U mycc -d mycc_dev
```

## 下一步

Phase 1 已完成，接下来：
- Phase 2: 多用户 HTTP 服务器改造
- Phase 3: API 接口设计
- Phase 4: 计费系统
- Phase 5: 部署和运维
