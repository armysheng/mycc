# about-me

> OpenClaw + MyCC 适配后的主上下文目录。
> 会话初始化与上下文注入以本目录为准。

## 启动入口链路

`CLAUDE.md` -> `0-System/about-me/README.md` -> `AGENTS.md` -> 其余文件

如果你在排查“为什么助手行为不一致”，先按这个顺序检查。

## 文件说明
- `AGENTS.md`：行为与流程约束
- `SOUL.md`：人格与语气
- `TOOLS.md`：工具和环境约定
- `IDENTITY.md`：助手身份
- `USER.md`：用户信息与称呼
- `MEMORY.md`：长期记忆
- `HEARTBEAT.md`：心跳任务（可选）
- `BOOTSTRAP.md`：首次初始化引导（完成后归档到 `5-Archive/bootstrap/`）

## 记忆文件落点

- `0-System/status.md`：短期快照（hook 注入）
- `0-System/context.md`：中期上下文（周维度）
- `0-System/about-me/MEMORY.md`：长期结构化记忆
- `0-System/memory/YYYY-MM-DD.md`：每日原始记录
- `0-System/memory/heartbeat-state.json`：心跳检查状态

## 更新责任

- 初始化阶段：由 bootstrap 会话填写 `IDENTITY.md`、`USER.md`、`MEMORY.md`。
- 日常对话阶段：优先更新 `status.md` 与当日 `0-System/memory/YYYY-MM-DD.md`。
- 周期收敛：将每日记录提炼到 `context.md` 与 `about-me/MEMORY.md`。

## 一致性原则
- `0-System/about-me/` 是身份与称呼的唯一真相源。
- 若与历史文件（例如 `~/.claude/projects/.../memory/MEMORY.md`）冲突，以本目录为准并执行同步。
- `CLAUDE.md` 只保留桥接约束，不应写死助手名称或用户称呼。
