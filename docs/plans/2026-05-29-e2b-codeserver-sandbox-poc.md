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
- Agent SDK 和 code-server 的 cwd 都限定在 `/home/{linuxUser}/workspace`。
- Agent SDK 子进程的 `HOME` / `CLAUDE_CONFIG_DIR` 不继承服务进程，默认写到 `/home/{linuxUser}/.mycc`。

## 后端接口骨架

- `GET /api/ide/config`：返回 Remote IDE 能力状态。默认 `disabled`。
- `POST /api/ide/sessions/plan`：在 `MYCC_IDE_PROVIDER=e2b` 时生成 E2B/code-server session plan；当前不创建真实 sandbox。
- `POST /api/ide/sessions`：在 `MYCC_IDE_PROVIDER=e2b` 且配置 `MYCC_E2B_API_KEY` 后，通过 provider 创建 POC session；响应隐藏 E2B host 和 traffic token。
- `GET /api/ide/sessions/:id/status`：查询内存 session 状态，按登录用户隔离。
- `E2bSandboxProvider.startCodeServer(plan)`：已封装 `Sandbox.create`、私有网络、后台启动 code-server、host/traffic token 获取，并通过注入 fake sandbox 测试。

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

1. 增加 `E2bSandboxProvider`，封装 create/connect/extend/kill/runBackground/getHost。
2. 增加 `IdeSessionService` 的真实 start/stop/status/renew，落库或 Redis 保存 `userId -> ideSessionId -> sandboxId -> pid -> port`。
3. 增加 mycc 反向代理，支持 WebSocket upgrade，并自动注入 `e2b-traffic-access-token`。
4. 把 Claude Agent SDK runtime 切到 sandbox provider，确保 IDE 和 agent 共享同一 workspace。
5. 做 POC 验收：直接访问 E2B host 失败，通过 mycc 一次性 URL 打开 IDE，IDE 修改文件后 Claude 能读到，Claude 修改文件后 IDE 能看到。
