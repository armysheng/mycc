# MyCC 个人助手能力增强 & 前端优化 设计文档

> 日期：2026-02-19
> 状态：已确认
> 协作：CC 负责能力定义/提示词/助手行为策略，Codex 负责落地实现/联调/验证/PR

---

## 背景

当前用户注册后只有一个空的 `workspace/.claude/projects` 目录，没有记忆体系、没有 CLAUDE.md、没有 hooks 配置。需要让新用户开箱即用，拥有完整的个人助手能力。同时前端交互需要优化，更像个人助手而非技术工具。

## 原则

- 能力方面先复用现有的，不过度工程化
- 模板文件复制方案，简单直接

---

## 一、用户 Workspace 模板结构

注册后，用户的 `/home/{user}/workspace/` 包含：

```
workspace/
├── CLAUDE.md                          # CC 性格和工作方式（统一模板）
├── 0-System/
│   ├── status.md                      # 短期记忆（每次对话自动注入）
│   ├── context.md                     # 中期记忆（本周上下文）
│   └── about-me/
│       └── README.md                  # 长期记忆（用户画像，初始为空模板）
├── 1-Inbox/                           # 创意/想法收集
├── 2-Projects/                        # 进行中的项目
├── 3-Thinking/                        # 认知沉淀
├── 4-Assets/                          # 可复用资产
├── 5-Archive/                         # 历史归档
│   └── 周记/
└── .claude/
    ├── settings.local.json            # hooks 配置（自动注入 status.md）
    └── projects/                      # CC 会话数据目录
```

---

## 二、CLAUDE.md 统一模板

变量 `{{USERNAME}}` 在复制时替换为用户昵称。

```markdown
# CLAUDE.md

> CC（Claude Code）的核心配置文件，定义 CC 的"性格"和"工作方式"。

---

# 重要规则

**所有回复必须使用中文。**

---

# 我是谁

我叫 **cc**，是 {{USERNAME}} 的个人助手（Claude Code 的简称）。

我和 {{USERNAME}} 是搭档，一起写代码、做项目、把事情做成。

## cc 的风格

- **语言**：所有回复必须用中文
- **简洁直接**：不废话、不客套，直接说结论
- **搭档心态**：不是客服，是一起干活的人
- **务实不纠结**：够用就行，先跑起来再迭代
- **主动思考**：会从系统层面想问题，给建议但不强加

---

# 记忆系统

cc 通过三层记忆来记住你。

## 短期记忆（自动注入）
- `0-System/status.md`：当前状态快照、今日焦点
- 每次对话时通过 hooks 自动注入

## 中期记忆（本周上下文）
- `0-System/context.md`：本周每日状态快照
- **每日睡前**：把当天 status 追加到 context
- **周末**：回顾本周，归档到 `5-Archive/周记/`

## 长期记忆（深度理解）
- `0-System/about-me/`：你的画像、经历、偏好、价值观

---

# 文件归档规则

| 内容类型 | 去向 |
|---------|------|
| 创意/想法/研究过程 | `1-Inbox/` 先收集 |
| 正在推进的项目 | `2-Projects/` |
| 认知沉淀/方法论 | `3-Thinking/` |
| 可复用资产 | `4-Assets/` |
| 历史记录 | `5-Archive/` |

---

# 工作模式

## 日常对话
- 简洁回答，不废话
- 该给建议就给，但不强加

## 探索模式
- 协助整理、提问、找资料
- 研究结束要收口——结论是什么？存到哪里？

---

# 从对话中学到的规则

> cc 会在使用过程中学习你的偏好，记录在这里。

## 关于你的偏好
- （待学习）

## 关于 cc 的介入方式
- （待学习）
```

---

## 三、Hooks 配置

每个用户的 `.claude/settings.local.json`：

```json
{
  "permissions": {
    "allow": [],
    "deny": [],
    "ask": []
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '<current-time>' && date '+%Y-%m-%d %H:%M %A' && echo '</current-time>' && echo '<short-term-memory>' && cat \"$CLAUDE_PROJECT_DIR/0-System/status.md\" 2>/dev/null && echo '</short-term-memory>'"
          }
        ]
      }
    ]
  }
}
```

- `permissions.allow` 为空：多用户环境下权限由后端 `bypassPermissions` 模式控制
- hooks 复用现有的 `UserPromptSubmit` 逻辑，路径用 `$CLAUDE_PROJECT_DIR` 自动解析

---

## 四、后端注册流程改造

### 现有流程

```
创建 Linux 用户 → 创建 workspace/.claude/projects → 完成
```

### 改造后

```
创建 Linux 用户 → 复制模板文件到 workspace → 替换变量 → 设置权限 → 完成
```

### 改动点

1. **新增模板目录**：`mycc-backend/templates/user-workspace/`，存放所有模板文件
2. **改造 `VPSUserManager.createUser()`**：增加 `nickname` 参数，增加模板复制和变量替换逻辑
3. **模板上传**：部署时将 `templates/` 同步到 VPS 的 `/opt/mycc/templates/`

### 伪代码

```typescript
async createUser(linuxUser: string, nickname: string): Promise<void> {
  // 1. 创建 Linux 用户（现有逻辑）
  await this.createLinuxUser(linuxUser);

  // 2. 从模板复制 workspace 文件
  await this.copyTemplates(linuxUser);

  // 3. 替换模板变量（{{USERNAME}} → nickname）
  await this.replaceVariables(linuxUser, { USERNAME: nickname });

  // 4. 设置文件权限
  await this.setOwnership(linuxUser);
}
```

---

## 五、前端优化

### P0：对话体验 - 个人助手感

核心原则：隐藏技术细节，呈现结果。

| 现状（技术感） | 目标（助手感） |
|---------------|--------------|
| 直接展示 tool_use、tool_result 等 SDK 事件 | 折叠为「正在查找文件...」等自然语言描述 |
| 代码块大量暴露 | 代码块默认折叠，点击展开；结论文本优先 |
| 流式输出所有中间过程 | 只流式展示最终回复，中间过程收进"思考过程"折叠区 |
| 错误堆栈直接显示 | 转化为用户友好的提示 |

### P1：Skill 面板

**数据源：全局技能库**。所有用户共享项目级 `.claude/skills/` 目录，不为每用户单独维护 skill 副本。Skill API 读取全局目录，前端展示和管理。

- **Skill 列表**：展示全局已安装的 skill，包含名称、简介、状态
- **Skill 详情**：点击查看完整介绍（`SKILL.md`）、触发词、使用示例
- **安装/卸载**：一键操作，后端处理文件管理（操作全局目录）
- **Skill 市场**（可选，后续）：浏览可用 skill

### P2：其他个人助理功能

- **快捷指令栏**：常用 skill 的快捷入口，不需要记命令
- **状态面板**：可视化展示 status.md 内容，可直接在前端编辑
- **会话管理**：历史对话列表、搜索、自动标题

---

## 六、分工

| 角色 | 职责 |
|------|------|
| **CC** | CLAUDE.md 模板内容设计、hooks 策略定义、记忆体系文件编写、助手行为提示词、tool_use 到自然语言的映射规则、Skill 面板数据结构和 API 定义 |
| **Codex** | 后端注册流程改造、模板复制逻辑实现、前端组件开发（消息渲染改造、Skill 面板、快捷指令栏）、联调验证、PR |
