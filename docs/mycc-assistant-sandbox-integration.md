# MyCC Assistant Sandbox Integration

这份文档给 MyCC 后端、前端和 Agent runtime 对接 `mycc-assistant-sandbox-dev` 使用。文档只描述配置形状和能力边界，不记录、不打印任何真实密钥、token、base URL 或裸 E2B host。

## 目标

`mycc-assistant-sandbox-dev` 是 MyCC 个人助理沙盒模板。它把 code-server、CCR、Claude/Agent runtime、GNU desktop、浏览器自动化和常用 Node/Python/GNU 工具放在同一个用户 sandbox 里。

MyCC 后端负责：

- 创建或复用同一个 E2B sandbox。
- 注入用户/租户 provider 环境变量。
- 按需启动 sandbox 内服务。
- 通过 MyCC proxy 暴露 code-server/noVNC。
- 向浏览器隐藏 E2B host、traffic token、provider base URL 和 provider token。

浏览器只访问 MyCC 同源 API，不直接访问 E2B。

## 模板

默认模板名：

```text
mycc-assistant-sandbox-dev
```

源码位置：

```text
mycc-sandbox/templates/e2b-assistant-sandbox
```

构建/验证入口：

```bash
cd mycc-sandbox
npm install
npm run doctor:template
npm run smoke:e2b-template
```

真实 E2B smoke 会创建临时 sandbox，验证 full contract、code-server、GNU desktop/noVNC、Playwright/Chromium 自动化，然后清理 sandbox。

Agent browser smoke 额外验证 Claude Agent SDK 会通过真实 `tool_use` 打开桌面浏览器，而不是由 MyCC 前端或后端写死浏览器启动动作：

```bash
cd mycc-sandbox
npm run smoke:e2b-agent-browser
```

## 内置服务

沙盒内按需启动这些服务：

| Service | Entrypoint | 默认端口 | 用途 |
| --- | --- | ---: | --- |
| code-server | `mycc-start-code-server` | `18080` | 用户在浏览器里查看和编辑 `/home/mycc/workspace` |
| CCR | `mycc-start-ccr` | `13456` | sandbox 内 Claude/Agent 请求路由，读取注入 env |
| GNU desktop | `mycc-start-desktop` | `16080` noVNC / `15900` VNC | XFCE 桌面、GUI app、浏览器可视化操作显示管线 |
| desktop health | `mycc-health-desktop` | - | 检查 noVNC/desktop 是否可用 |
| deliverable registry | `mycc-register-deliverable` | - | 将报告、截图、日志等用户可见成果登记到 `.mycc/deliverables.json` |

这些服务共享：

```text
/home/mycc/workspace
```

### 任务工作目录

每个聊天任务都应该落到一个明确的 workspace cwd。默认 cwd 是用户侧：

```text
/home/<linuxUser>/workspace
```

当用户从 `/projects/demo` 进入聊天时，前端传 `workingDirectory: "/demo"`，后端解析成：

```text
/home/<linuxUser>/workspace/demo
```

E2B 运行时再把这个用户侧 cwd 映射到沙箱内同路径段：

```text
/home/mycc/workspace/demo
```

code-server、文件空间和成果 registry 的根目录仍然是 `/home/mycc/workspace`，不会因为任务 cwd 是子目录就重复创建 sandbox 或把 IDE 根切到子目录。元数据统一放在 `/home/mycc/workspace/.mycc/`。后端必须拒绝 `/home/<other>/...`、`../` 归一化越界、空字节等不在当前用户 workspace root 下的 cwd。

`mycc-start-desktop` 只启动 Xvfb、XFCE、x11vnc、websockify/noVNC。它不主动打开 Chromium。可见浏览器应该由 Claude Agent SDK 在执行 `browser-use` 或浏览器相关工具调用时运行到 `${MYCC_DESKTOP_DISPLAY:-:99}`，MyCC 只负责把这个桌面镜像给用户看。

### 成果登记

Agent 产出报告、截图、运行记录、预览或数据文件后，优先调用模板内置 helper 登记成果，而不是手写 JSON：

```bash
mycc-register-deliverable \
  --path /reports/summary.md \
  --title "Project summary" \
  --kind report \
  --description "Current project status and next steps"
```

helper 会写入 `/home/mycc/workspace/.mycc/deliverables.json`，按 workspace path 去重，并拒绝隐藏路径、越界路径和疑似 secret/token 的标题、描述或文件名。MyCC 后端的 `/api/assistant/deliverables` 会读取这个 registry 并合并扫描兜底结果。

## 内置运行时能力

模板基于 Playwright Python noble image，并额外安装：

- Node.js 22、npm、corepack
- Python 3.12、venv、pip、uv
- browser-use `0.12.9`
- Playwright `1.60.0`
- Chromium，命令名 `chromium`
- code-server `4.106.3`
- Claude Code `2.1.158`
- Claude Agent SDK bridge，路径 `/opt/mycc-agent-runtime/bridge.mjs`
- `@anthropic-ai/claude-agent-sdk` `0.3.158`
- `@musistudio/claude-code-router` `2.0.0`，命令名 `ccr`
- GNU/native toolchain：`git`、`rg`、`jq`、`gcc`、`g++`、`make`、`pkg-config`、`file`、`lsof`、`tree`
- GNU desktop：Xvfb、XFCE、x11vnc、noVNC、websockify、dbus-x11、xdotool、x11-utils

为了让 E2B command runner 也能稳定找到工具，模板还做了两个链接：

- `/usr/local/bin/uv -> /opt/mycc/browser-agent/venv/bin/uv`
- `/home/mycc/.cache/ms-playwright -> /ms-playwright`

## 内置 Skills

这里的 skill 指会被复制到 Claude/MyCC skill 目录的 `SKILL.md` 包。当前模板内置两类：

- 沙盒专属 skill：`browser-use`
- MyCC base skills：从 `mycc-backend/src/skills/catalog` 同步到沙盒模板

| Skill | 路径 | 触发场景 | 依赖能力 |
| --- | --- | --- | --- |
| `browser-use` | `/home/mycc/.claude/skills/browser-use/SKILL.md` 和 `/home/mycc/.mycc/skills/browser-use/SKILL.md` | Agent 需要在沙盒内操作真实浏览器、跑 Playwright 或使用 browser-use 做浏览器导航 | Python venv、Playwright、browser-use、Chromium、可选 GNU desktop display |
| `browser` | `/home/mycc/.claude/skills/browser/SKILL.md` 和 `/home/mycc/.mycc/skills/browser/SKILL.md` | 用 Playwright 测试/调试本地 Web 应用、截图、查看浏览器日志 | Playwright、Chromium、Node/Python |
| `pdf` | `/home/mycc/.claude/skills/pdf/SKILL.md` 和 `/home/mycc/.mycc/skills/pdf/SKILL.md` | PDF 阅读、提取、表单、转换和视觉校验 | Python、PDF helper scripts |
| `docx` | `/home/mycc/.claude/skills/docx/SKILL.md` 和 `/home/mycc/.mycc/skills/docx/SKILL.md` | Word 文档创建、编辑、批注、修订处理 | Python、Office helper scripts |
| `xlsx` | `/home/mycc/.claude/skills/xlsx/SKILL.md` 和 `/home/mycc/.mycc/skills/xlsx/SKILL.md` | Excel/电子表格读取、编辑、重算和分析 | Python、spreadsheet helper scripts |
| `pptx` | `/home/mycc/.claude/skills/pptx/SKILL.md` 和 `/home/mycc/.mycc/skills/pptx/SKILL.md` | PPT 创建、编辑、清理、缩略图和结构化演示稿处理 | Python、presentation helper scripts |
| `data-analysis` | `/home/mycc/.claude/skills/data-analysis/SKILL.md` 和 `/home/mycc/.mycc/skills/data-analysis/SKILL.md` | CSV/表格数据分析、可视化、报告 | Python、数据分析运行时 |
| `deep-research` | `/home/mycc/.claude/skills/deep-research/SKILL.md` 和 `/home/mycc/.mycc/skills/deep-research/SKILL.md` | 深度调研、证据追踪、格式可控研究报告 | 搜索/资料收集工具、workspace |
| `skill-installer` | `/home/mycc/.claude/skills/skill-installer/SKILL.md` 和 `/home/mycc/.mycc/skills/skill-installer/SKILL.md` | 从策展仓库安装/管理更多 skills | GitHub/network、workspace |
| `skill-creator` | `/home/mycc/.claude/skills/skill-creator/SKILL.md` 和 `/home/mycc/.mycc/skills/skill-creator/SKILL.md` | 创建和验证自定义 skill | Python、workspace |

`browser-use` skill 建议默认值：

```text
Workspace: /home/mycc/workspace
Browser agent venv: /opt/mycc/browser-agent/venv
Desktop display: ${MYCC_DESKTOP_DISPLAY:-:99}
Desktop resolution: ${MYCC_DESKTOP_RESOLUTION:-1440x900}
Chromium executable: chromium
Chromium window size: ${MYCC_DESKTOP_BROWSER_WINDOW_SIZE:-1360,820}
```

使用策略：

- 可确定的浏览器任务优先使用 Playwright。
- 需要 LLM 参与网页导航、表单探索或复杂交互时再用 browser-use。
- 需要可视化排查时先启动 GNU desktop，再让浏览器跑在 desktop display 上。
- `browser-use` skill 自己解析用户提到的网站或链接，并直接启动 desktop display 上的 Chromium；不要依赖 MyCC 代码解析用户消息或注入 URL。

同步命令：

```bash
cd mycc-sandbox
npm run skills:sync
```

`code-server`、CCR、desktop、Agent SDK bridge、Node/Python 工具链是沙盒能力，不是 skill 包。

## Browser-use 可见浏览器链路

目标链路：

```text
用户消息
  -> MyCC chat API
  -> Claude Agent SDK bridge
  -> Claude 原生 skill/tool_use
  -> browser-use/Playwright/Chromium on GNU desktop display
  -> MyCC workbench 右侧 noVNC 镜像
```

职责边界：

- Claude 负责理解“打开/查看/操作网页”的意图，并通过 skill/tool_use 选择具体 URL、命令和浏览器动作。
- `browser-use`/`browser` skill 负责在沙盒内使用 Playwright、browser-use 或 Chromium。
- `mycc-start-desktop` 只负责显示服务，不负责业务导航。
- MyCC 后端只在看到 Claude assistant 事件里的真实浏览器相关 `tool_use` 后，向前端发出 `workbench` SSE 信号。
- MyCC 前端收到 `workbench` 信号后，只打开右侧工作台并启动/复用 desktop noVNC iframe。

明确不要做：

- 不保留 `mycc-open-browser` 这类 wrapper 脚本。
- 不由前端解析聊天文本里的 URL。
- 不由后端根据用户消息硬编码打开哪个网页。
- 不写死“运行记录”“助理已准备好”等假执行文案。

## MyCC 后端配置

联调时后端使用以下配置形状。真实密钥通过私有 `.env` 或部署 secret 注入，不进入文档或日志。

```bash
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_DESKTOP_PORT=16080
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
```

还需要设置 E2B API key：

```bash
MYCC_E2B_API_KEY=...
# 或
E2B_API_KEY=...
```

不要打印真实值。

## 数据库迁移

当前第一阶段仍复用 `ide_sessions`，并增加 desktop 兼容字段：

```text
mycc-backend/db/migrations/004-add-ide-desktop-service.sql
```

新增列：

- `desktop_pid`
- `desktop_host`
- `desktop_port`

后续再迁移到真正的：

- `sandbox_sessions`
- `sandbox_services`
- `runtime_env_profiles`

## MyCC API 对接

### 配置

```http
GET /api/ide/config
```

期望返回公开能力字段：

```json
{
  "success": true,
  "data": {
    "provider": "e2b",
    "enabled": true,
    "codeServerPort": 18080,
    "desktopEnabled": true,
    "desktopPort": 16080,
    "accessMode": "mycc-proxy",
    "e2bTemplate": "mycc-assistant-sandbox-dev"
  }
}
```

不要返回裸 E2B host、traffic token、provider base URL 或 provider token。

### 打开 code-server

```http
POST /api/ide/sessions
```

行为：

- 创建或复用当前用户 running E2B sandbox。
- 启动或复用 code-server。
- 返回 tokenless MyCC `openPath`，形如 `/api/ide/sessions/:id/proxy/`。
- `POST /api/ide/sessions` 同时设置 scoped HttpOnly proxy cookie；前端不需要、也不应该拿到 URL token。

### 打开 GNU desktop

```http
POST /api/ide/sessions/:id/desktop
```

行为：

- 在同一个 sandbox 内启动或复用 GNU desktop。
- 返回 tokenless `desktop.openPath`，指向 MyCC noVNC proxy 页面。
- `POST /api/ide/sessions/:id/desktop` 同时设置 scoped HttpOnly proxy cookie。
- noVNC WebSocket 走 `/api/ide/sessions/:id/desktop/proxy/websockify`。

### Proxy

```http
/api/ide/sessions/:id/proxy/*
/api/ide/sessions/:id/desktop/proxy/*
```

MyCC 后端在 proxy 层注入 E2B traffic token。浏览器、前端 JS 和页面 URL 都不应该接触这个 token。

## 前端入口

Workbench/Workspace 第一阶段提供两个按钮：

- `打开代码编辑器`
- `打开桌面工作间`

交互要求：

- 点击时同步打开 placeholder tab，避免浏览器拦截。
- 后端返回 MyCC `openPath` 后再导航这个 tab。
- 禁止把 raw host、traffic token、provider token 或 provider base URL 放进页面状态、URL、日志或错误提示。
- 低层数据库/迁移错误要映射成用户可读文案，例如“工作区暂不可用，请稍后重试。”

Chat Workbench 右侧栏第一阶段包含三个入口：

- 镜像浏览器
- 文件空间
- 预览

右上角浮动小图标负责切换、锁回浏览器主页态、全屏和关闭。桌面端右栏默认使用 `clamp(640px, 52vw, 880px)`，配合沙箱默认 `1440x900` 桌面和 `1360,820` Chromium 窗口，避免浏览器画面挤成角标。VNC iframe 在切换 tab 或收起右栏时保持挂载，避免每次都冷启动 noVNC。iframe 允许同源 `postMessage` 辅助切回主页态、聚焦或切换 tab；这只改变 MyCC UI 状态，不负责打开具体网页。

## CCR 对接

CCR 在用户镜像内，由 MyCC 后端启动并注入环境变量。推荐形状：

```text
MYCC_PROVIDER_BASE_URL
MYCC_PROVIDER_API_KEY
MYCC_CCR_AUTH_TOKEN
MYCC_CCR_MODEL
```

要求：

- `mycc-start-ccr` 生成的配置引用环境变量，不把明文 secret 写进命令行参数。
- Claude CLI / Agent SDK bridge 默认访问 sandbox-local CCR。
- provider base URL/token 不返回浏览器，不写普通日志。

## 联调命令

模板层：

```bash
cd mycc-sandbox
npm run doctor:template
npm run smoke:e2b-template
```

后端 API 层：

```bash
cd mycc-backend
npm run doctor:e2b-agent
npm run smoke:e2b-desktop
npm run smoke:e2b-ide
```

如果后端不在默认 `8080`：

```bash
BASE_URL=http://localhost:18082 npm run smoke:e2b-desktop
```

前端：

```bash
cd mycc-web-react
npm test -- --run src/components/WorkspacePage.test.tsx
npm test -- --run src/components/MessageComponents.test.tsx src/components/ChatPage.workbench.test.tsx
npm run typecheck
```

## 已验证状态

2026-06-01 本轮验收记录：

- `mycc-sandbox npm run template:create`：已重建 `mycc-assistant-sandbox-dev`。
- `mycc-sandbox npm run doctor:template`：通过本地模板文件、可执行入口、凭据存在性和 template exists 检查。
- `mycc-sandbox npm run smoke:e2b-template`：通过 full contract、code-server、desktop/noVNC、Chromium 打开、browser automation 和 cleanup。
- `mycc-sandbox npm run smoke:e2b-agent-browser`：返回 `ok: true`，看到浏览器相关 Claude `tool_use`、Baidu 目标和 running Chromium。
- `mycc-backend npm run doctor:e2b-agent`：通过 E2B/Agent runtime/provider/public traffic/CCR credential/template 预检。
- `mycc-backend npm test -- --run src/routes/chat.e2b-context.test.ts src/agent-runtime/e2b-claude-agent-sdk-runtime.test.ts src/agent-runtime/e2b-claude-cli-runtime.test.ts`：通过任务 cwd 解析、越界拒绝、E2B CLI/Agent SDK cwd 映射，以及 create-before-IDE 仍复用 workspace 根目录启动 code-server。
- `cd mycc-backend && BASE_URL=http://127.0.0.1:18081 npm run smoke:e2b-desktop`：通过 MyCC desktop proxy/noVNC 验证，直接 E2B desktop host 未授权访问被拒绝，临时 session 已清理。
- `cd mycc-backend && BASE_URL=http://127.0.0.1:18081 npm run smoke:e2b-ide`：通过旧 code-server 路径验证，临时 session 已清理。
- `mycc-web-react npm test -- --run src/components/WorkspacePage.test.tsx`：通过 workspace 打开 code-server/desktop 的代理入口测试。
- `mycc-web-react npm test -- --run src/components/MessageComponents.test.tsx src/components/ChatPage.workbench.test.tsx src/config/api.test.ts`：通过假运行记录删除、右侧 workbench browser 信号、VNC iframe 保持挂载、全屏/锁回/文件切换，以及 IDE openPath 只接受 MyCC proxy 路径测试。
- `mycc-web-react npm run typecheck`：通过前端类型检查。

验收结果只记录命令形状和公开状态，不记录真实密钥、token、provider base URL 或裸 E2B host。

## 后续扩展路径

数据模型建议从第一阶段的 `ide_sessions` 扩为：

- `sandbox_sessions`：一个用户/项目对应一个 E2B sandbox 生命周期。
- `sandbox_services`：同一 sandbox 下的 `code-server`、`desktop`、`browser-preview`、`app-preview` 等服务。
- `sandbox_capabilities`：模板声明的 code、desktop、browser automation、skills、native toolchain 等能力。
- `runtime_env_profiles`：CCR/provider base URL/token、模型、配额和租户配置引用；真实 secret 仍只放服务端 secret/env。

UI 扩展顺序：

1. 保持右侧 noVNC iframe 展示镜像浏览器。
2. 增加浏览器预览服务时，作为新的 `sandbox_services` 能力挂到同一个 workbench。
3. GUI app stream 仍复用 desktop 显示管线，除非后续选择独立 app-stream 协议。

## 增加新 Skill 的方式

新增 skill 时放到：

```text
mycc-sandbox/templates/e2b-assistant-sandbox/skills/<skill-name>/SKILL.md
```

然后补：

- `mycc-sandbox/test/sandbox-contract.test.mjs`
- `mycc-sandbox/scripts/smoke-local-contract.mjs`
- 必要时补 full contract 或 E2B smoke

构建后模板会复制到：

```text
/opt/mycc/skills
/home/mycc/.mycc/skills
/home/mycc/.claude/skills
```

新增 skill 不应包含真实 token、base URL 或账号信息。
