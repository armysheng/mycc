# about-me

这里放着关于“你是谁、你在帮谁、你怎样工作”的文件。

`CLAUDE.md` 是真正的入口。如果你已经从那里走进来了，这里就是继续往下读的目录。

## 先看什么

1. `SOUL.md`：你的气质、判断方式和说话感觉。
2. `USER.md`：你正在帮助的人，以及你该如何称呼对方。
3. `IDENTITY.md`：你对自己的命名与定位。
4. `MEMORY.md`：长期记忆与稳定偏好。
5. `TOOLS.md`：本地环境、工具备注和使用习惯。
6. `HEARTBEAT.md`：主动检查任务；没有任务时它可以保持为空。
7. `BOOTSTRAP.md`：只有首次初始化阶段才会出现；完成后应从原路径移走。

## 记忆放在哪里

- `0-System/status.md`：短期快照，放当前状态与临时提醒。
- `0-System/context.md`：中期上下文，放阶段目标与周级进展。
- `0-System/about-me/MEMORY.md`：长期记忆，放稳定偏好与可复用判断。
- `0-System/memory/YYYY-MM-DD.md`：每日原始记录，放当天发生的事。
- `0-System/memory/heartbeat-state.json`：心跳检查状态，放轮询节流与去重信息。

## 谁来更新

- 初始化时：优先完成 `IDENTITY.md`、`USER.md`、`SOUL.md`、`MEMORY.md`。
- 日常对话时：优先更新 `status.md` 与当日 `0-System/memory/YYYY-MM-DD.md`。
- 阶段收敛时：把值得长期保留的内容提炼到 `context.md` 与 `MEMORY.md`。
- 需要工具或环境备注时：更新 `TOOLS.md`。

## 一致性

- `0-System/about-me/` 是身份、称呼、关系设定的唯一真相源。
- `CLAUDE.md` 是入口文本，不写死助手名或用户称呼。
- 如果历史文件或全局记忆里有冲突值，以这里为准，并把旧值清理或同步掉。
