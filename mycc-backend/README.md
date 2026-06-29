# MyCC Backend

MyCC 商业化后端服务

## 快速开始

### 1. 启动开发环境

```bash
# 方式一：使用自动化脚本（推荐）
./dev-setup.sh

# Codex worktree：固定端口 3001/8081，并先检查/启动 Postgres、Redis
../scripts/dev-codex.sh

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

# Codex worktree readiness
curl http://localhost:8081/readyz

# 注册用户
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone": "<TEST_PHONE_FROM_ENV>", "password": "<TEST_PASSWORD_FROM_ENV>", "nickname": "测试用户"}'

# 登录
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"credential": "<TEST_PHONE_OR_EMAIL_FROM_ENV>", "password": "<TEST_PASSWORD_FROM_ENV>"}'
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
  "phone": "<USER_PHONE>",     // 可选，与 email 二选一
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
      "phone": "<USER_PHONE>",
      "nickname": "用户昵称",
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
  "credential": "<USER_PHONE_OR_EMAIL>",  // 手机号或邮箱
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
    "phone": "<USER_PHONE>",
    "nickname": "用户昵称",
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
| MYCC_REGISTRATION_MODE | 注册入口控制：`open` 开放注册，`invite` 必须提供邀请码，`closed` 关闭新注册 | open |
| MYCC_REGISTRATION_INVITE_CODES | 邀请码列表，逗号或换行分隔；仅 `MYCC_REGISTRATION_MODE=invite` 时使用 | - |
| MYCC_ONBOARDING_ASYNC | 初始化异步化开关；设为 `true` 时初始化请求快速返回 `running`，前端轮询 `/api/onboarding/status` 到 `ready` | false |
| ANTHROPIC_API_KEY | Claude API 密钥 | - |
| PORT | 服务端口 | 8080 |
| NODE_ENV | 运行环境 | development |
| MYCC_CORS_ORIGINS | CORS origin allowlist，逗号分隔；未设置、空字符串、纯空白或只包含空项时使用本地开发默认值。由于后端启用 `credentials=true`，不能使用 `*`，否则启动会失败 | `http://localhost:3001`, `http://localhost:3000`, `http://127.0.0.1:3001` |
| PLAN_FREE_TOKENS | 免费版额度 | 300000 |
| PLAN_BASIC_TOKENS | 基础版额度 | 3000000 |
| PLAN_PRO_TOKENS | 专业版额度 | 12000000 |
| PLAN_BASIC_PRICE_CNY | 基础版月费（人民币） | 39 |
| PLAN_PRO_PRICE_CNY | 专业版月费（人民币） | 99 |
| MYCC_AGENT_RUNTIME | Agent 运行时：`e2b-claude-agent-sdk`、`e2b-claude-cli`、`claude-agent-sdk` 或 legacy `remote-claude` | e2b-claude-agent-sdk |
| MYCC_CCR_BASE_URL | Claude/Anthropic 请求的 CCR router base URL，优先级最高 | - |
| MYCC_CCR_AUTH_TOKEN | CCR router auth token，和 `MYCC_CCR_API_KEY` 二选一 | - |
| MYCC_CCR_API_KEY | CCR router API key，优先级低于 `MYCC_CCR_AUTH_TOKEN` | - |
| MYCC_CLAUDE_BASE_URL | 非 CCR 的 Claude/Anthropic 代理 base URL | - |
| MYCC_CLAUDE_AUTH_TOKEN | 非 CCR 代理 auth token | - |
| MYCC_CLAUDE_API_KEY | 非 CCR 代理 API key | - |
| MYCC_AGENT_SDK_BASE_URL | Agent SDK 的 legacy Anthropic/CCR base URL | - |
| MYCC_AGENT_SDK_AUTH_TOKEN | Agent SDK/CCR auth token | - |
| MYCC_AGENT_SDK_API_KEY | Agent SDK Anthropic API key | ANTHROPIC_API_KEY |
| MYCC_AGENT_SDK_MODEL | Agent SDK 默认模型 | claude-opus-4-7 |
| MYCC_AGENT_SDK_ALLOWED_TOOLS | Agent SDK 自动允许工具，逗号分隔；系统保护由 MyCC hooks 与隔离环境承担 | Read,Glob,Grep,Bash,Edit,Write |
| MYCC_AGENT_SDK_PERMISSION_MODE | Agent SDK 权限模式 | bypassPermissions |
| MYCC_AGENT_SDK_PARTIAL_MESSAGES | 是否输出 SDK partial stream event | false |
| MYCC_AGENT_SDK_CONFIG_ROOT | 自管容器可选 runtime 根目录；为空时使用 `/home/{linux_user}` 和 `/home/{linux_user}/.claude` | - |
| MYCC_AGENT_RUN_TRACE | 是否记录 agent run trace；设为 `false` 可关闭 trace wrapper | true |
| MYCC_AGENT_RUN_STORE | Agent run trace store；P2+ 环境执行迁移后应使用 `postgres` | postgres |
| MYCC_HARNESS_OTEL | Harness OpenTelemetry span 开关；设为 `false` 可关闭 agent/eval/sandbox/verifier spans | true |
| MYCC_OTEL_ENABLED | 全局 OTEL 兼容开关；设为 `false` 也会关闭 harness spans | true |
| MYCC_WORKSPACE_PROVIDER | 内置 Workspace API provider：`e2b` 复用当前用户 running E2B sandbox session，`ssh` 为 legacy VPS 路径 | e2b |
| MYCC_IDE_PROVIDER | 工作区 provider：`e2b` 或 `disabled` | e2b |
| MYCC_IDE_PORT | code-server 在沙箱内监听的端口 | 18080 |
| MYCC_IDE_SESSION_TTL_SECONDS | IDE sandbox/session 默认 TTL | 3600 |
| MYCC_E2B_API_KEY | E2B API key，优先使用；也兼容 `E2B_API_KEY`，格式前缀必须为 `e2b_<token>` | - |
| MYCC_E2B_TEMPLATE | E2B 模板名；MyCC 个人助理沙盒默认使用 `mycc-assistant-sandbox-dev`，旧 code-server 路径可继续显式用 `mycc-code-server-dev` | mycc-assistant-sandbox-dev |
| MYCC_E2B_DESKTOP_ENABLED | 是否暴露 GNU 桌面能力；`mycc-assistant-sandbox-dev` 默认启用，也可显式设为 `true` | auto |
| MYCC_E2B_DESKTOP_PORT | noVNC 在沙箱内监听的端口 | 16080 |
| MYCC_E2B_ALLOW_PUBLIC_TRAFFIC | 是否允许 E2B host 直接公网访问；产品路径必须为 false | false |

### Agent Runtime

后端聊天和自动化都通过 `src/agent-runtime` 工厂创建运行时，方便逐步接入不同底层：

- `e2b-claude-agent-sdk`：默认产品路径，在同一个 E2B/code-server sandbox 内执行 `/opt/mycc-agent-runtime/bridge.mjs`，由 bridge 调用 `@anthropic-ai/claude-agent-sdk`，并复用 Remote IDE workspace。
- `remote-claude`：legacy/rollback 路径，通过 SSH 在 VPS 用户工作区执行 `claude --print --output-format stream-json`。
- `claude-agent-sdk`：使用官方 `@anthropic-ai/claude-agent-sdk` 在隔离用户环境中启动 Claude Code agent。默认 `settingSources: user,project`、`permissionMode: bypassPermissions`、`allowedTools: Read,Glob,Grep,Bash,Edit,Write`，并强制 cwd 落在 `/home/{linux_user}/workspace` 下。系统保护由 MyCC hooks、cwd 约束和沙箱策略承担，避免每次普通操作都打断用户确认。
- `e2b-claude-cli`：在 E2B/code-server sandbox 内执行 `claude --print --output-format stream-json`，优先复用当前用户未过期 Remote IDE session；如果 chat 先发生，会自动创建 sandbox/session。
- `e2b-claude-agent-sdk` 依赖 `MYCC_IDE_PROVIDER=e2b` 和 `MYCC_WORKSPACE_PROVIDER=e2b`，默认 E2B sandbox 用户为 `mycc`，workspace 为 `/home/mycc/workspace`。

`claude-agent-sdk` runtime 会覆盖传给 SDK 子进程的 `HOME`、`CLAUDE_CONFIG_DIR`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`。默认每个隔离用户使用 `/home/{linux_user}`，Claude 用户级配置、记忆模板和 skills 写到 `/home/{linux_user}/.claude`；如果运行在自管容器且希望挂载专用 runtime 卷，可设置 `MYCC_AGENT_SDK_CONFIG_ROOT=/srv/mycc/runtime`，最终目录为 `/srv/mycc/runtime/{linux_user}/{home,.claude}`。

如果要让 Claude/Agent SDK 通过 ccr router 转换/路由模型，可先启动 ccr，再优先配置 `MYCC_CCR_*`；mycc 会把它映射为 Anthropic runtime 需要的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。如果 ccr router 再转发到 OpenAI-compatible provider，把 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 配在 ccr router 内部；不要把全局 `OPENAI_*` 直接复用于 mycc 的 Claude runtime，避免误用其他 OpenAI-compatible 服务凭据。

```bash
MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_CCR_BASE_URL=http://127.0.0.1:3456
MYCC_CCR_AUTH_TOKEN=<ccr-api-key-or-token>
MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep,Bash,Edit,Write
MYCC_AGENT_SDK_PERMISSION_MODE=bypassPermissions
```

注意：`remote-claude` 仅作为 legacy/rollback 路径保留；生产多用户主路径使用 `e2b-claude-agent-sdk`，由 E2B sandbox、MyCC hooks、cwd 约束和后端代理共同提供隔离与系统保护。

### Harness / Agent Run Trace

后端默认会把 runtime 包装为 traced runtime。trace 写入是 best-effort，写入失败不会中断用户聊天。默认内存 store 适合本地调试；执行 `npm run db:migrate` 后，可启用 Postgres 持久化：

```bash
MYCC_AGENT_RUN_TRACE=true
MYCC_AGENT_RUN_STORE=postgres
```

Harness OpenTelemetry 由 `src/harness/telemetry.ts` 统一接入，覆盖 agent run、观察到的工具事件、sandbox readiness、agent eval 和 harness verifier。未配置 OTEL provider/exporter 时，OpenTelemetry API 会 no-op；如需临时关闭：

```bash
MYCC_HARNESS_OTEL=false
```

### MyCC Assistant Sandbox / code-server / GNU desktop

后端已接入 `/api/ide/config`、`/api/ide/sessions/plan`、`POST /api/ide/sessions`、`/api/ide/sessions/:id/open`、`/api/ide/sessions/:id/status`、renew/delete 和 `/api/ide/sessions/:id/proxy/*`。在 assistant sandbox 模板上，还支持 `POST /api/ide/sessions/:id/desktop`、`/api/ide/sessions/:id/desktop/open` 和 `/api/ide/sessions/:id/desktop/proxy/*`。默认 `MYCC_IDE_PROVIDER=e2b`；创建或复用 session 时会按 user/template/linux user/workspace/port 匹配，并等待 code-server `/healthz` ready 后才返回。响应会隐藏 E2B host 与 traffic token，浏览器只拿 MyCC open path，后端 proxy 再注入 `e2b-traffic-access-token`。

```bash
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_DESKTOP_PORT=16080
MYCC_E2B_API_KEY=e2b_<token>
# 或使用 E2B_API_KEY=e2b_<token>
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
```

安全默认值是：code-server 和 noVNC 只作为 mycc 反向代理后的能力暴露，沙箱内部固定端口分别为 `18080` 和 `16080`，code-server 启动命令使用 `--auth none` 但必须配合 `E2B allowPublicTraffic:false + MyCC open path + HttpOnly proxy cookie + 后端注入 e2b-traffic-access-token`。不要把 E2B public host、traffic token、provider base URL/token 或裸 noVNC/code-server 地址直接给产品用户。

本地 smoke：

```bash
npm run harness:verify -- --target=landing --no-write
npm run verify:e2b-release
npm run doctor:e2b-agent
npm run smoke:e2b-ide
npm run smoke:e2b-desktop
npm run smoke:e2b-agent-workspace
npm run smoke:e2b-agent-sdk-workspace
```

正式 landing 前，对目标环境运行：

```bash
BASE_URL=http://localhost:8080 npm run harness:verify -- --target=landing-live --no-write
```

生产启用/回滚门禁请按 `docs/e2b-release-readiness.md` 和 `docs/landing-readiness.md` 执行；`verify:e2b-release` 会在不读取外部密钥的前提下确认迁移、template 发布脚本、runtime contract、bridge contract 和 smoke 安全断言没有漂移。

先跑 `doctor:e2b-agent` 可以在不打印密钥的前提下检查 E2B key、template、Agent runtime、IDE/Workspace provider、Claude/CCR 凭据和全局 `OPENAI_*` 误注入风险。有有效 E2B key 时，它会额外向 E2B 查询 `MYCC_E2B_TEMPLATE` 是否存在。

这些 smoke 需要有效的 `MYCC_E2B_API_KEY=e2b_<token>` 或 `E2B_API_KEY=e2b_<token>`；agent smoke 还需要 Anthropic/CCR 凭据。过期 session 可用 `npm run cleanup:ide-sessions` 清理。assistant sandbox 模板自身的 contract、doctor 和真实 E2B desktop/browser smoke 在仓库根目录的 `mycc-sandbox` 模块内维护。

`smoke:e2b-agent-workspace` 和 `smoke:e2b-agent-sdk-workspace` 会额外验证 E2B template 契约：`code-server`、Node/Python/Git/curl、GNU 常用工具链必须可用；CLI runtime 需要 `claude`，Agent SDK runtime 需要 `/opt/mycc-agent-runtime/bridge.mjs`。

当前 E2B workspace 是 `/home/mycc/workspace`。代码编辑器、GNU desktop 与 `e2b-claude-cli` / `e2b-claude-agent-sdk` 会共享这份 sandbox 文件系统；设置 `MYCC_WORKSPACE_PROVIDER=e2b` 后，内置 Workspace API 的文件树、读取、保存和管理员 exec 也会复用同一个 running E2B sandbox session。没有 running session 时，Workspace API 会返回 `409`，提示先打开代码编辑器，避免一次普通文件树请求隐式创建昂贵 sandbox。

E2B agent runtime 的 chat 项目上下文会通过同一个 `ensureE2bIdeSession` 提前创建或复用 E2B IDE session，并从 sandbox 用户目录的 `/home/mycc/.claude/about-me` 读取用户级记忆与身份；workspace 只保存当前项目文件和产出。全新 sandbox 若还没有任何可用 about-me 内容，会跳过注入且不缓存 missing context，后续可通过首次同步/初始化补齐。

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
npm run dev:codex    # 启动依赖后使用 8081 端口运行
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
