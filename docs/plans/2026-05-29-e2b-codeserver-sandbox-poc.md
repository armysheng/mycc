# E2B + code-server Sandbox POC

## 目标

把 Claude Agent SDK、Claude Code 和可选 `code-server` 放进同一个 GNU/Linux 沙箱里运行，让用户既能通过 mycc chat 驱动 agent，也能按需打开 IDE 查看和编辑同一份 workspace。

## 当前结论

- E2B 适合做第一版远程沙箱 POC：支持 Debian/Ubuntu 模板、预装 GNU 工具链、后台进程、端口 host、pause/resume 和 sandbox timeout。
- `code-server` 适合做可选 IDE 入口：推荐在 E2B template 中预装，运行时按 session 动态启动。
- Claude 没有官方可嵌入 UI SDK；mycc 继续自研 ClaudeCode Web 壳，后端用 Agent SDK/Claude Code 事件流做统一协议层。

## 安全默认值

- E2B sandbox 必须使用 `allowPublicTraffic:false`。
- 用户不能直接拿到裸 E2B host；访问路径必须是 mycc 后端反向代理。
- mycc 后端代理时注入 `e2b-traffic-access-token`，用户侧只拿一次性 mycc token。
- code-server POC 启动为 `--auth none`，但只允许在上述反代链路内使用。
- code-server 固定内部端口 `18080`，避免和用户应用常用的 `3000/8080` 冲突。
- 非 E2B Agent SDK runtime 的 cwd 限定在 `/home/{linuxUser}/workspace`，子进程 `HOME` / `CLAUDE_CONFIG_DIR` 默认写到 `/home/{linuxUser}/.mycc`。
- E2B template 内部默认 Linux 用户是 `mycc`，Remote IDE 和 E2B Claude CLI runtime 都使用 `/home/mycc/workspace`；业务用户隔离依赖独立 sandbox/session，而不是在 sandbox 内复刻 `mycc_u{id}` 用户。

## 后端接口骨架

- `GET /api/ide/config`：返回 Remote IDE 能力状态。默认 `disabled`。
- `POST /api/ide/sessions/plan`：在 `MYCC_IDE_PROVIDER=e2b` 时生成 E2B/code-server session plan；仅返回安全的公开 plan。
- `POST /api/ide/sessions`：在 `MYCC_IDE_PROVIDER=e2b` 且配置 `MYCC_E2B_API_KEY` 后，通过 provider 创建 POC session；响应隐藏 E2B host 和 traffic token。
- `GET /api/ide/sessions/:id/open`：使用一次性 open token 换取 HttpOnly proxy cookie，然后 302 到后端 proxy。
- `GET /api/ide/sessions/:id/status`：查询持久化 session 状态，按登录用户隔离。
- `POST /api/ide/sessions/:id/renew` / `DELETE /api/ide/sessions/:id`：续期或停止 E2B/code-server session。
- `/api/ide/sessions/:id/proxy/*`：mycc 后端反向代理 code-server HTTP 和 WebSocket，服务端注入 `e2b-traffic-access-token`。
- `E2bSandboxProvider.startCodeServer(plan)`：已封装 `Sandbox.create`、私有网络、后台启动 code-server、host/traffic token 获取，并通过注入 fake sandbox 测试。
- `PostgresIdeSessionStore`：生产默认将 IDE session 元数据写入 `ide_sessions`，测试仍可注入内存 store。
- `mycc-web-react` 工作区页已提供 “打开 Remote IDE” 最小入口。
- `npm run smoke:e2b-ide`：提供真实 E2B/code-server 端到端 smoke，失败也会 cleanup session。
- `npm run smoke:e2b-agent-workspace`：直接创建 E2B/code-server sandbox，并用 `e2b-claude-cli` runtime 在同一 `sandboxId` 内做 workspace 双向读写 smoke。
- `MYCC_AGENT_RUNTIME=e2b-claude-cli`：新增 Claude CLI bridge runtime，复用当前用户的 running IDE session，通过 `sandboxId` 连接 E2B，并在同一个 `/home/mycc/workspace` 执行 `claude --print --output-format stream-json`。
- `POST /api/ide/sessions`：同一用户已有未过期 running session 时直接复用，避免重复创建 E2B sandbox。

当前实现刻意不把内部 `startCommand`、E2B host 或 traffic token 返回给客户端，避免前端依赖服务端执行细节或绕过后端代理。

## E2B Template 草案

```Dockerfile
FROM ubuntu:22.04

ARG CODE_SERVER_VERSION=4.100.3
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    ca-certificates curl git bash procps dumb-init \
    build-essential pkg-config python3 nodejs npm ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash mycc \
  && mkdir -p /home/mycc/workspace \
  && chown -R mycc:mycc /home/mycc

RUN curl -fsSL https://code-server.dev/install.sh \
  | sh -s -- --method=standalone --prefix=/usr/local --version ${CODE_SERVER_VERSION}

USER mycc
WORKDIR /home/mycc/workspace
```

## 下一步实现切片

1. 用真实 `MYCC_E2B_API_KEY` 和已发布 template 跑 `npm run smoke:e2b-ide`。
2. 用真实 E2B + Claude 凭据跑 `npm run smoke:e2b-agent-workspace`，验证 Claude CLI runtime 和 code-server 共享 `/home/mycc/workspace`。
3. 增加过期 session 清理任务，生产环境对 `traffic_access_token` 做加密或改为 token reference。
4. 后续如果确实需要 SDK 级事件能力，再在 sandbox 内增加 Agent SDK bridge；当前优先使用 Claude CLI `stream-json`，与现有协议兼容。
5. 做 POC 验收：直接访问 E2B host 失败，通过 mycc 一次性 URL 打开 IDE，IDE 修改文件后 Claude 能读到，Claude 修改文件后 IDE 能看到。
