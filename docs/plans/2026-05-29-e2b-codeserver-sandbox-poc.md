# E2B + code-server Sandbox POC

## 目标

把 Claude Agent SDK、Claude Code 和可选 `code-server` 放进同一个 GNU/Linux 沙箱里运行，让用户既能通过 mycc chat 驱动 agent，也能按需打开 IDE 查看和编辑同一份 workspace。

## 当前结论

- E2B 适合做第一版远程沙箱 POC：支持 Debian/Ubuntu 模板、预装 GNU 工具链、后台进程、端口 host、pause/resume 和 sandbox timeout。
- `code-server` 适合做可选 IDE 入口：推荐在 E2B template 中预装，运行时按 session 动态启动。
- Claude 没有官方可嵌入 UI SDK；mycc 继续自研 ClaudeCode Web 壳，后端用 Agent SDK/Claude Code 事件流做统一协议层。
- CCR router 的接入点放在 Claude provider env 层：mycc 读取 `MYCC_CCR_*` / `MYCC_CLAUDE_*` / 兼容旧变量后，统一映射为 Claude/Anthropic runtime 需要的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`。不直接读取全局 `OPENAI_*`，避免和其他 OpenAI-compatible 用途混淆。

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
- `POST /api/ide/sessions`：在 `MYCC_IDE_PROVIDER=e2b` 且配置 `MYCC_E2B_API_KEY` 或 `E2B_API_KEY` 后，通过 provider 创建 POC session；响应隐藏 E2B host 和 traffic token。
- `GET /api/ide/sessions/:id/open`：使用一次性 open token 换取 HttpOnly proxy cookie，然后 302 到后端 proxy。
- `GET /api/ide/sessions/:id/status`：查询持久化 session 状态，按登录用户隔离。
- `POST /api/ide/sessions/:id/renew` / `DELETE /api/ide/sessions/:id`：续期或停止 E2B/code-server session。
- `/api/ide/sessions/:id/proxy/*`：mycc 后端反向代理 code-server HTTP 和 WebSocket，服务端注入 `e2b-traffic-access-token`。
- `E2bSandboxProvider.startCodeServer(plan)`：已封装 `Sandbox.create`、私有网络、后台启动 code-server、host/traffic token 获取，并通过注入 fake sandbox 测试。
- `PostgresIdeSessionStore`：生产默认将 IDE session 元数据写入 `ide_sessions`，测试仍可注入内存 store。
- `mycc-web-react` 工作区页已提供 “打开 Remote IDE” 最小入口。
- `npm run smoke:e2b-ide`：提供真实 E2B/code-server 端到端 smoke，失败也会 cleanup session。
- `npm run smoke:e2b-agent-workspace`：直接创建 E2B/code-server sandbox，并用 `e2b-claude-cli` runtime 在同一 `sandboxId` 内做 workspace 双向读写 smoke。
- `npm run smoke:e2b-agent-sdk-workspace`：同一 smoke 流程，但 agent runtime 切到 `e2b-claude-agent-sdk`，通过 sandbox 内 `/opt/mycc-agent-runtime/bridge.mjs` 调 `@anthropic-ai/claude-agent-sdk`。
- `npm run cleanup:ide-sessions`：扫描过期 running IDE session，调用 E2B stop 并落库为 stopped，减少 sandbox 残留和成本泄漏。
- `MYCC_AGENT_RUNTIME=e2b-claude-cli`：新增 Claude CLI bridge runtime，优先复用当前用户的 running IDE session；如果 chat 先发生且没有 session，会自动创建 E2B/code-server session 并写入同一个 store，再通过 `sandboxId` 在 `/home/mycc/workspace` 执行 `claude --print --output-format stream-json`。
- `MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk`：新增 E2B Agent SDK bridge runtime，复用同一 IDE sandbox/session，在 `/home/mycc/workspace` 调 `/opt/mycc-agent-runtime/bridge.mjs`，由 bridge 执行 `@anthropic-ai/claude-agent-sdk` 并按 NDJSON 输出 SDK message。
- `POST /api/ide/sessions`：同一用户已有未过期 running session 时直接复用，避免重复创建 E2B sandbox。
- `resolveClaudeProviderEnv()`：Agent SDK runtime 与 E2B Claude CLI runtime 共用 Claude/CCR env 解析。base URL 优先级为 `MYCC_CCR_BASE_URL` > `MYCC_CLAUDE_BASE_URL` > `MYCC_AGENT_SDK_BASE_URL` > `ANTHROPIC_BASE_URL` > `VPS_ANTHROPIC_BASE_URL`；credential 只转发第一组命中的 token/api key，避免 `ANTHROPIC_AUTH_TOKEN` 和旧 `ANTHROPIC_API_KEY` 同时下发。

当前实现刻意不把内部 `startCommand`、E2B host 或 traffic token 返回给客户端，避免前端依赖服务端执行细节或绕过后端代理。

## E2B Template 契约

实际模板在 `mycc-backend/templates/e2b-code-server`。模板需要包含：

- GNU/Linux 工具链：`bash`、`coreutils`、`findutils`、`grep`、`sed`、`gawk`、`tar`、`gzip`、`git`、`openssh-client`、`ripgrep`、`jq`、`build-essential`、`make`、`pkg-config`、`python3`、`python3-venv`、`lsof`、`net-tools`、`file`、`tree`、`less`、`vim`、`nano`、`zip`、`unzip`。
- Node.js 22、`code-server`、全局 `@anthropic-ai/claude-code`。
- `/opt/mycc-agent-runtime/node_modules/@anthropic-ai/claude-agent-sdk`。
- `/opt/mycc-agent-runtime/bridge.mjs`，供 `e2b-claude-agent-sdk` runtime 默认执行 `cd /opt/mycc-agent-runtime && node bridge.mjs`。

bridge 通过 env 接收 `MYCC_AGENT_PROMPT_B64`、`MYCC_AGENT_WORKSPACE_CWD=/home/mycc/workspace`、可选 `MYCC_AGENT_SESSION_ID`、`ANTHROPIC_*`、`CLAUDE_CONFIG_DIR` 和 `HOME`，并以每行一个 JSON SDK message 的形式输出。

## 下一步实现切片

1. 用真实 `MYCC_E2B_API_KEY` 或 `E2B_API_KEY` 和已发布 template 跑 `npm run smoke:e2b-ide`。
2. 用真实 E2B + Claude/CCR 凭据跑 `npm run smoke:e2b-agent-workspace`，验证 Claude CLI runtime 和 code-server 共享 `/home/mycc/workspace`，并覆盖 chat-first 自动创建 session 后 Remote IDE 复用的产品路径。
3. 用同一组凭据跑 `npm run smoke:e2b-agent-sdk-workspace`，验证 Agent SDK bridge runtime 也能复用同一 sandbox/workspace；该 smoke 会设置写文件所需的 SDK 工具/权限默认值，产品默认仍保持只读工具集。
4. 将 `npm run cleanup:ide-sessions` 接到生产 cron 或部署平台定时任务；生产环境对 `traffic_access_token` 做加密或改为 token reference。
5. 做 POC 验收：直接访问 E2B host 失败，通过 mycc 一次性 URL 打开 IDE，IDE 修改文件后 Claude 能读到，Claude 修改文件后 IDE 能看到。
6. 把 Workspace API 抽成 provider：VPS 模式继续走 SSH `/home/{linuxUser}/workspace`；E2B 模式走当前用户 running sandbox 的 `/home/mycc/workspace`。否则 Workspace 页内置文件树/Monaco、Remote IDE、Agent runtime 会指向不同文件系统。
7. E2B 模式下调整 chat 项目上下文注入：不要继续从 VPS `/home/{linuxUser}/workspace` 读取上下文；应从 E2B workspace 读取，或在首次创建 sandbox 时显式同步项目文件。

## Claude UI / SDK 调研结论

- Anthropic 当前提供的是 Claude Code、Claude Code SDK（`@anthropic-ai/claude-code`）和 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`），没有官方可嵌入 MyCC 的 Claude/Claude Code UI SDK。
- 2026-05-30 查询到 npm 最新版本：`@anthropic-ai/claude-code@2.1.157`、`@anthropic-ai/claude-agent-sdk@0.3.157`。
- 后端已可升级到 `@anthropic-ai/claude-code@2.1.157` 和 `@anthropic-ai/claude-agent-sdk@0.3.157`；前端 `mycc-web-react` 暂时保留 `@anthropic-ai/claude-code@1.0.108` 作为 `SDKMessage` 类型来源，因为 2.x 不再提供当前代码使用的模块类型声明。
- MyCC 继续自研 ClaudeCode Web 壳更合适；`opcode`、`claudecodeui` 等开源项目适合做体验 benchmark，但许可证、单机优先架构、多租户隔离和计费都不适合直接并入。
- 前端下一阶段优先级：权限审批、文件 diff 可视化、命令 stdout/stderr、断线恢复、长任务后台状态和移动端审批队列。
