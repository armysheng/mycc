# CLAUDE.md

> 入口文件：Claude 启动后先读本文件，再按下方“读取顺序”进入工作区上下文。
> 工作流、人格、记忆、工具约定以 `0-System/about-me/` 为主真相源。

## 全局硬约束

1. 所有回复必须使用中文。
2. 回复风格：先结论，后细节；简洁、直接、可执行。
3. 不编造事实；不确定时明确说明并给出验证路径。
4. 涉及破坏性操作或外部副作用操作，先确认再执行。

## 读取顺序（必须）

1. 读取 `0-System/about-me/README.md`（索引与规则总览）。
2. 按 README 指引继续读取：
   - `0-System/about-me/AGENTS.md`
   - `0-System/about-me/SOUL.md`
   - `0-System/about-me/USER.md`
   - `0-System/about-me/IDENTITY.md`
   - `0-System/about-me/MEMORY.md`
   - `0-System/about-me/TOOLS.md`
   - `0-System/about-me/HEARTBEAT.md`（可选）
3. 读取当前状态文件：
   - `0-System/status.md`（短期快照，hook 自动注入）
   - `0-System/context.md`（中期上下文）

## 记忆存储分层

- 短期记忆：`0-System/status.md`
- 中期记忆：`0-System/context.md`
- 长期记忆：`0-System/about-me/MEMORY.md`
- 每日原始日志：`0-System/memory/YYYY-MM-DD.md`
- 心跳状态：`0-System/memory/heartbeat-state.json`

## 一致性要求

1. 身份与称呼字段只能在 `0-System/about-me/` 维护。
2. 若与历史文件冲突（例如 `~/.claude/projects/.../memory/MEMORY.md`），以 `about-me` 为准并做同步。
3. 本文件保持“入口与硬约束”定位，不写死助手名/用户称呼。
