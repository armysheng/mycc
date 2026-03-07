# Onboarding 上下文统一与模板适配设计（MyCC x OpenClaw）

> 日期：2026-03-05  
> 状态：Draft / 待评审  
> 适用范围：`mycc-backend/templates/user-workspace/*`、onboarding/chat 注入链路

---

## 1. 背景与问题

当前初始化链路存在“多真相源并行”问题：

1. 身份字段可能同时出现在 `CLAUDE.md`、`0-System/about-me/*`、`~/.claude/projects/.../memory/MEMORY.md`。
2. daily/context/memory 的职责边界不清，导致同字段重复写入。
3. OpenClaw 模板被引入后，部分路径仍沿用旧写法（如 `memory/YYYY-MM-DD.md`），与 MyCC 目录结构不完全一致。

结果是：助手名称、用户称呼、角色语气在会话中漂移，用户感知为“初始化不稳定”。

---

## 2. 目标与非目标

## 2.1 目标

1. 建立单一入口链：`CLAUDE.md -> about-me/README.md -> 关键人格文件`。
2. 建立单一真相源：身份/称呼/角色设定统一由 `0-System/about-me/` 管理。
3. 固化 5 层记忆分层，明确“存储在哪里、谁负责更新”。
4. 让 MyCC 目录结构与 OpenClaw 初始化模板语义对齐，不再依赖事后 copy/move。

## 2.2 非目标

1. 本轮不重做 prompt 引擎。
2. 本轮不改业务 API 协议结构（仅增强提示词与模板契约）。
3. 本轮不强依赖外部长期记忆服务，仍以工作区文件为主。

---

## 3. 统一后的目录与职责

## 3.1 目录结构（关键部分）

```text
/home/<linux_user>/workspace/
├── CLAUDE.md
└── 0-System/
    ├── status.md
    ├── context.md
    ├── memory/
    │   ├── YYYY-MM-DD.md
    │   └── heartbeat-state.json
    └── about-me/
        ├── README.md
        ├── SOUL.md
        ├── TOOLS.md
        ├── IDENTITY.md
        ├── USER.md
        ├── MEMORY.md
        ├── HEARTBEAT.md
        └── BOOTSTRAP.md
```

## 3.2 记忆分层定义（定版）

1. 短期：`0-System/status.md`  
用途：当前状态快照，hook 自动注入。
2. 中期：`0-System/context.md`  
用途：周级上下文与阶段目标。
3. 长期：`0-System/about-me/MEMORY.md`  
用途：稳定偏好、长期约束、可复用结论。
4. 每日原始日志：`0-System/memory/YYYY-MM-DD.md`  
用途：当天事件流水，不作为身份真值。
5. 心跳状态：`0-System/memory/heartbeat-state.json`  
用途：定时检查去重和节流状态。

---

## 4. 单一真相源规则

## 4.1 字段归属

身份类字段（强约束）只允许写在 `0-System/about-me/*`：

1. 助手名称
2. 用户称呼
3. 角色设定 / 交互风格锚点

## 4.2 冲突处理优先级

当字段冲突时按以下优先级处理：

1. `0-System/about-me/*`（最高）
2. `CLAUDE.md`（仅入口约束，不承载身份真值）
3. `~/.claude/projects/.../memory/MEMORY.md`（历史兼容层）

结论：任何冲突均回写到 about-me 体系并对旧来源做同步或忽略。

---

## 5. 启动入口与读取链

## 5.1 入口定位

`CLAUDE.md` 只承担两件事：

1. 全局硬约束（语言、风格、安全边界）。
2. 明确“接下来去哪读”的链路。

## 5.2 追溯链（必须可达）

1. `CLAUDE.md`
2. `0-System/about-me/README.md`
3. `SOUL.md / USER.md / IDENTITY.md / MEMORY.md / TOOLS.md / HEARTBEAT.md`
4. `0-System/status.md` + `0-System/context.md` + `0-System/memory/*`

要求：任何关键规则都必须能从 `CLAUDE.md` 追溯到源文件。

---

## 6. Onboarding 流程（实现口径）

## 6.1 服务端 initialize

1. 校验 `assistantName/ownerName`。
2. 预检 workspace 与关键模板。
3. 失败则自愈（建用户、补模板、修权限）。
4. 执行 legacy 根目录 markdown 迁移到 `0-System/about-me/`。
5. 生成 bootstrapPrompt（包含冲突对齐规则 + memory 目录初始化要求 + 初始化票据）。
6. 不在 initialize 阶段标记 `is_initialized`，仅保存待完成状态。

## 6.2 前端触发 bootstrap

1. onboarding 成功后进入 chat。
2. 首轮自动发送 `bootstrapPrompt`（隐藏用户消息）。
3. 模型在会话内完成初始化文件写入。
4. 后端在 bootstrap 成功校验后才执行 `markUserInitialized`。

## 6.3 chat 上下文注入

1. 首轮会话注入 about-me 关键文件。
2. 注入内容包含“about-me 单一真相源”规则。
3. 与 legacy/global memory 冲突时按规则收敛。

---

## 7. 更新责任矩阵

| 场景 | 主要写入 | 补充写入 | 禁止写入 |
|---|---|---|---|
| 初始化会话 | `about-me/IDENTITY.md` `about-me/USER.md` `about-me/MEMORY.md` | `0-System/memory/YYYY-MM-DD.md` 首日记录 | 工作区根目录身份文件 |
| 日常对话 | `0-System/status.md` `0-System/memory/YYYY-MM-DD.md` | 重要结论提炼到 `about-me/MEMORY.md` | 在 daily/status 写身份真值 |
| 每周收敛 | `0-System/context.md` | 清理 `about-me/MEMORY.md` 过期项 | 修改 CLAUDE.md 承载身份 |
| 心跳任务 | `0-System/memory/heartbeat-state.json` | 必要时写 daily | 直接覆盖 about-me 真值 |

---

## 8. 模板适配策略（MyCC x OpenClaw）

## 8.1 保留 OpenClaw 能力

1. `about-me` 多文件人格体系。
2. `BOOTSTRAP.md` 会话内初始化思路。
3. `CLAUDE/SOUL/TOOLS` 的行为约束框架。

## 8.2 MyCC 本地化改造

1. 所有 memory 路径统一到 `0-System/memory/*`。
2. `CLAUDE.md` 改为 bridge+入口，不承载身份值。
3. `README.md` 新增“更新责任”和“存储落点”。
4. `BOOTSTRAP.md` 增加 MyCC 目录适配要求（不写根目录、初始化 memory 目录）。

---

## 9. 迁移与兼容

## 9.1 新用户

直接使用新模板，不再产生根目录身份文件。

## 9.2 老用户

1. onboarding/repair 路径执行一次 legacy 迁移。
2. 若检测到 `~/.claude/projects/.../memory/MEMORY.md` 与 about-me 冲突：
   - 以 about-me 为准
   - 进行同步或标注忽略
3. 后续可提供管理员批处理脚本做全量对齐（建议 follow-up）。

---

## 10. 验收标准

1. 从 `CLAUDE.md` 可以追溯到所有关键规则文件。
2. 新用户初始化后，不再出现“助手名/称呼”双真值。
3. `status/context/about-me/daily` 各自职责明确，无重复真值字段。
4. 聊天首轮注入和 onboarding bootstrap 均包含一致性规则。
5. 模板与代码构建、测试通过。

---

## 11. 评审清单（给 Claude）

1. 单一真相源规则是否足够硬，是否还需代码层强制覆盖。
2. `is_initialized` 标记时机是否应后移到 bootstrap 成功后。
3. 对老用户冲突文件是否需要自动修复脚本立即落地。
4. 是否要把“字段写入边界”加入自动化 lint/检查。
