# about-me

> OpenClaw 主上下文目录。会话初始化与上下文注入以本目录为准。

## 文件说明
- `AGENTS.md`：行为与流程约束
- `SOUL.md`：人格与语气
- `TOOLS.md`：工具和环境约定
- `IDENTITY.md`：助手身份
- `USER.md`：用户信息与称呼
- `MEMORY.md`：长期记忆
- `HEARTBEAT.md`：心跳任务（可选）
- `BOOTSTRAP.md`：首次初始化引导（完成后归档到 `5-Archive/bootstrap/`）

## 一致性原则
- `0-System/about-me/` 是身份与称呼的唯一真相源。
- 若与历史文件（例如 `~/.claude/projects/.../memory/MEMORY.md`）冲突，以本目录为准并执行同步。
- `CLAUDE.md` 只保留桥接约束，不应写死助手名称或用户称呼。
