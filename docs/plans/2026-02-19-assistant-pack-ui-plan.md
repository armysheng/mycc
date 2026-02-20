# MyCC 个人助手能力增强 & 前端优化 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让新用户注册后开箱即用拥有完整个人助手能力，同时优化前端对话体验和 Skill 管理。

**Architecture:** 后端通过模板文件复制方案在用户注册时初始化 workspace；前端在现有 React 组件基础上改造消息渲染（隐藏技术细节）、新增 Skill 管理面板。

**Tech Stack:** TypeScript, Fastify, React, SSH2 (VPS 操作)

**设计文档:** `docs/plans/2026-02-19-mycc-personal-assistant-design.md`

**Worktree 说明:** 本项目使用 git worktree 隔离开发。在开始前执行：
```bash
git worktree add ../mycc-assistant-pack feature/assistant-pack-ui
cd ../mycc-assistant-pack
```

---

## Phase 1: 后端 - 用户模板体系

### Task 1: 创建模板目录和文件

**Files:**
- Create: `mycc-backend/templates/user-workspace/CLAUDE.md`
- Create: `mycc-backend/templates/user-workspace/0-System/status.md`
- Create: `mycc-backend/templates/user-workspace/0-System/context.md`
- Create: `mycc-backend/templates/user-workspace/0-System/about-me/README.md`
- Create: `mycc-backend/templates/user-workspace/.claude/settings.local.json`

**Step 1: 创建模板目录结构**

```bash
mkdir -p mycc-backend/templates/user-workspace/{0-System/about-me,1-Inbox,2-Projects,3-Thinking,4-Assets,5-Archive/周记,.claude/projects}
```

**Step 2: 创建 CLAUDE.md 模板**

写入 `mycc-backend/templates/user-workspace/CLAUDE.md`，内容使用 `{{USERNAME}}` 变量占位。完整内容见设计文档第二节。

**Step 3: 创建 status.md 模板**

写入 `mycc-backend/templates/user-workspace/0-System/status.md`：

```markdown
# Status（短期记忆）

> 自动注入给 cc。记录当前状态快照，随时更新。

---

## 今日快照

**日期**：{{DATE}}

**今天做了什么**：
- （记录今天的进展）

---

## 今日日程

> 状态：✅ 完成 / ⏳ 进行中 / ❌ 取消 / 空 = 待开始

| 时间 | 事项 | 状态 |
|------|------|------|
| - | （填写你的日程） | |

---

## 当前项目

| 项目 | 状态 | 下一步 |
|------|------|--------|
| 项目名 | 进行中 | 下一步行动 |

---

## 待办

- （零散的待办事项）

---

*最后更新：{{TIMESTAMP}}*
```

**Step 4: 创建 context.md 模板**

写入 `mycc-backend/templates/user-workspace/0-System/context.md`：

```markdown
# Context（中期记忆）

> 本周每日状态快照。每日睡前追加当天 status，周末归档。

---

## 本周概览

**周数**：第 X 周（MM/DD - MM/DD）

**本周重点**：（填写）

---

## 每日快照

### Day 1 - MM/DD（周X）

**做了什么**：
-

---

## 周末回顾

**本周完成**：
-

**本周未完成**：
-

**下周重点**：
-

---

*归档后移至 `5-Archive/周记/`*
```

**Step 5: 创建 about-me/README.md**

写入 `mycc-backend/templates/user-workspace/0-System/about-me/README.md`：

```markdown
# 关于我

> cc 在对话过程中会逐步了解你，并把重要信息记录在这里。

## 基本信息
- **名字**：{{USERNAME}}

## 偏好
- （待学习）

## 价值观
- （待学习）

## 经历
- （待学习）
```

**Step 6: 创建 hooks 配置**

写入 `mycc-backend/templates/user-workspace/.claude/settings.local.json`：

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

**Step 7: 为空目录添加 .gitkeep**

```bash
touch mycc-backend/templates/user-workspace/{1-Inbox,2-Projects,3-Thinking,4-Assets,5-Archive/周记,.claude/projects}/.gitkeep
```

**Step 8: Commit**

```bash
git add mycc-backend/templates/
git commit -m "feat: add user workspace template files"
```

---

### Task 2: 改造 VPSUserManager - 增加模板复制逻辑

**Files:**
- Modify: `mycc-backend/src/vps/user-manager.ts`

**Step 1: 修改 createUser 方法签名**

在 `mycc-backend/src/vps/user-manager.ts` 中，将 `createUser(linuxUser: string)` 改为 `createUser(linuxUser: string, nickname: string)`。

**Step 2: 增加模板部署检查和复制方法**

在 `VPSUserManager` 类中新增以下方法：

```typescript
/**
 * 将模板文件复制到用户 workspace 并替换变量
 *
 * 注意：路径拼接使用已经过 sanitizeLinuxUsername 验证的原始 linuxUser，
 * 不使用 escapeShellArg(linuxUser)，因为后者会加引号导致路径异常。
 * escapeShellArg 只在构造完整 shell 命令参数时使用。
 */
private async initWorkspace(connection: any, linuxUser: string, nickname: string): Promise<void> {
  const sshPool = getSSHPool();
  // linuxUser 已通过 sanitizeLinuxUsername 验证，只含 [a-z0-9_]，可安全拼路径
  const templateDir = '/opt/mycc/templates/user-workspace';
  const workspaceDir = `/home/${linuxUser}/workspace`;

  // 复制模板文件
  const copyCmd = `sudo cp -r ${templateDir}/. ${workspaceDir}/`;
  const copyResult = await sshPool.exec(connection, copyCmd);
  if (copyResult.exitCode !== 0) {
    throw new Error(`复制模板失败: ${copyResult.stderr}`);
  }

  // 替换变量 {{USERNAME}}（nickname 需要转义以防注入）
  const safeNickname = nickname.replace(/[/&\\]/g, '\\$&');
  const sedCmd = `sudo find ${workspaceDir} -type f \\( -name '*.md' -o -name '*.json' \\) -exec sed -i 's/{{USERNAME}}/${safeNickname}/g' {} +`;
  const sedResult = await sshPool.exec(connection, sedCmd);
  if (sedResult.exitCode !== 0) {
    console.warn(`⚠️ 变量替换部分失败: ${sedResult.stderr}`);
  }

  // 设置文件归属
  const chownCmd = `sudo chown -R ${linuxUser}:mycc /home/${linuxUser}`;
  await sshPool.exec(connection, chownCmd);
}
```

**Step 3: 在 createUser 中调用 initWorkspace**

替换原来的 `mkdir` 逻辑，改为调用 `initWorkspace`：

```typescript
async createUser(linuxUser: string, nickname: string = '用户'): Promise<void> {
  sanitizeLinuxUsername(linuxUser);
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();

  try {
    console.log(`[VPSUserManager] 开始创建用户: ${linuxUser}`);

    // 1. 创建 Linux 用户
    const createUserCmd = `sudo useradd -m -g mycc -s /bin/bash ${escapeShellArg(linuxUser)}`;
    const createResult = await sshPool.exec(connection, createUserCmd);
    if (createResult.exitCode !== 0) {
      throw new Error(`创建用户失败: ${createResult.stderr}`);
    }

    // 2. 初始化 workspace（复制模板 + 替换变量 + 设置权限）
    await this.initWorkspace(connection, linuxUser, nickname);

    console.log(`✅ VPS 用户创建成功: ${linuxUser}`);
  } catch (err) {
    console.error(`❌ 创建 VPS 用户失败:`, err);
    throw err;
  } finally {
    sshPool.release(connection);
  }
}
```

**Step 4: Commit**

```bash
git add mycc-backend/src/vps/user-manager.ts
git commit -m "feat: add workspace template initialization on user creation"
```

---

### Task 3: 改造注册流程 - 传递 nickname

**Files:**
- Modify: `mycc-backend/src/auth/service.ts:68`

**Step 1: 修改 register 函数中的 createUser 调用**

在 `mycc-backend/src/auth/service.ts` 第 68 行，将：

```typescript
vpsUserManager.createUser(user.linux_user).catch(err => {
```

改为：

```typescript
vpsUserManager.createUser(user.linux_user, user.nickname || '用户').catch(err => {
```

**Step 2: Commit**

```bash
git add mycc-backend/src/auth/service.ts
git commit -m "feat: pass nickname to VPS user creation for template variables"
```

---

### Task 4: 模板部署脚本

**Files:**
- Create: `mycc-backend/scripts/deploy-templates.sh`

**Step 1: 创建部署脚本**

```bash
#!/bin/bash
# 将模板文件同步到 VPS
set -e

VPS_HOST="${1:-armysheng@34.104.162.57}"
TEMPLATE_DIR="$(dirname "$0")/../templates/user-workspace"
REMOTE_DIR="/opt/mycc/templates/user-workspace"

echo "=== 部署模板到 ${VPS_HOST} ==="

# 创建远程目录
ssh "$VPS_HOST" "sudo mkdir -p $REMOTE_DIR"

# 同步文件（需要 sudo 权限写入 /opt）
rsync -avz --delete --rsync-path="sudo rsync" "$TEMPLATE_DIR/" "$VPS_HOST:$REMOTE_DIR/"

# 设置权限
ssh "$VPS_HOST" "sudo chmod -R 755 $REMOTE_DIR"

echo "✅ 模板部署完成"
```

**Step 2: 设置可执行权限**

```bash
chmod +x mycc-backend/scripts/deploy-templates.sh
```

**Step 3: Commit**

```bash
git add mycc-backend/scripts/deploy-templates.sh
git commit -m "feat: add template deployment script for VPS"
```

---

## Phase 2: 前端 - 对话体验优化（P0）

### Task 5: 消息渲染改造 - 工具调用自然语言化

**Files:**
- Modify: `mycc-web-react/src/components/MessageComponents.tsx`
- Create: `mycc-web-react/src/utils/toolDisplayMapper.ts`

**Step 1: 创建工具名称到自然语言的映射**

创建 `mycc-web-react/src/utils/toolDisplayMapper.ts`：

```typescript
/**
 * 将 tool_use 的工具名映射为用户友好的描述
 */
const TOOL_DISPLAY_MAP: Record<string, string> = {
  Read: '正在读取文件...',
  Write: '正在写入文件...',
  Edit: '正在编辑文件...',
  Bash: '正在执行命令...',
  Grep: '正在搜索代码...',
  Glob: '正在查找文件...',
  WebFetch: '正在获取网页内容...',
  WebSearch: '正在搜索网络...',
  Task: '正在处理子任务...',
  TodoWrite: '正在更新任务列表...',
  EnterPlanMode: '正在制定计划...',
  ExitPlanMode: '计划制定完成',
  AskUserQuestion: '需要你的确认...',
};

export function getToolDisplayText(toolName: string, input?: Record<string, any>): string {
  // 特殊处理：带文件名的工具
  if (toolName === 'Read' && input?.file_path) {
    const fileName = input.file_path.split('/').pop();
    return `正在读取 ${fileName}...`;
  }
  if (toolName === 'Edit' && input?.file_path) {
    const fileName = input.file_path.split('/').pop();
    return `正在编辑 ${fileName}...`;
  }
  if (toolName === 'Bash' && input?.command) {
    const cmd = input.command.split(' ')[0];
    return `正在执行 ${cmd}...`;
  }

  return TOOL_DISPLAY_MAP[toolName] || `正在使用 ${toolName}...`;
}

export function isToolVisibleToUser(toolName: string): boolean {
  // 这些工具的结果不需要直接展示给用户
  const hiddenTools = ['Glob', 'Grep', 'Read'];
  return !hiddenTools.includes(toolName);
}
```

**Step 2: 改造 ToolMessageComponent**

在 `MessageComponents.tsx` 中，将 `ToolMessageComponent` 从展示技术细节改为展示自然语言描述：

- 原来：显示工具名 + 完整参数
- 改后：显示自然语言描述（如"正在读取 service.ts..."），技术细节折叠

```tsx
// ToolMessageComponent 改造要点：
// 1. 用 getToolDisplayText() 替代原始工具名
// 2. 参数和详情默认折叠在 CollapsibleDetails 内
// 3. 使用更柔和的样式（淡灰色小字，而非醒目的 🔧 图标）
```

**Step 3: 改造 ToolResultMessageComponent**

- 成功的工具结果：默认折叠，只显示摘要（如"已读取 45 行"、"命令执行成功"）
- 失败的工具结果：显示友好错误提示，技术堆栈折叠
- Bash 输出：只展示最后几行结果，完整输出折叠

**Step 4: Commit**

```bash
git add mycc-web-react/src/utils/toolDisplayMapper.ts mycc-web-react/src/components/MessageComponents.tsx
git commit -m "feat: humanize tool call display in chat messages"
```

---

### Task 6: 思考过程折叠

**Files:**
- Modify: `mycc-web-react/src/components/MessageComponents.tsx`

**Step 1: 改造 ThinkingMessageComponent**

- 默认折叠，标题显示"cc 正在思考..."或"思考完成"
- 点击展开显示思考内容
- 使用淡色背景区分

**Step 2: Commit**

```bash
git add mycc-web-react/src/components/MessageComponents.tsx
git commit -m "feat: collapse thinking messages by default"
```

---

## Phase 3: 前端 - Skill 面板（P1）

### Task 7: 后端 Skill API

**Files:**
- Create: `mycc-backend/src/routes/skills.ts`

**Step 1: 创建 Skill 路由**

需要实现以下 API：

```
GET  /api/skills          - 列出当前用户已安装的 skill
GET  /api/skills/:name    - 获取 skill 详情（README、触发词等）
POST /api/skills/install  - 安装 skill（从 skill 市场或预置列表）
DELETE /api/skills/:name  - 卸载 skill
```

Skill 数据来源：读取全局项目级 `.claude/skills/` 目录（所有用户共享），不是每用户独立。每个 skill 目录包含 `SKILL.md`（大写）作为描述文件。

**Step 2: 在路由注册中添加 skill 路由**

找到路由注册文件，添加 `skillRoutes` 的注册。

**Step 3: Commit**

```bash
git add mycc-backend/src/routes/skills.ts
git commit -m "feat: add skill management API endpoints"
```

---

### Task 8: 前端 Skill 面板组件

**Files:**
- Create: `mycc-web-react/src/components/SkillPanel.tsx`
- Create: `mycc-web-react/src/hooks/useSkills.ts`

**Step 1: 创建 useSkills hook**

管理 skill 列表的获取、安装、卸载状态。

**Step 2: 创建 SkillPanel 组件**

- 侧边栏或抽屉形式
- Skill 列表：名称、简介、状态指示器
- Skill 详情：点击展开，显示触发词、使用示例
- 安装/卸载按钮

**Step 3: 集成到 ChatPage**

在 `ChatPage.tsx` 中添加 Skill 面板的入口按钮和面板容器。

**Step 4: Commit**

```bash
git add mycc-web-react/src/components/SkillPanel.tsx mycc-web-react/src/hooks/useSkills.ts mycc-web-react/src/components/ChatPage.tsx
git commit -m "feat: add skill management panel UI"
```

---

## Phase 4: 前端 - 辅助功能（P2）

### Task 9: 快捷指令栏

**Files:**
- Create: `mycc-web-react/src/components/QuickActions.tsx`

**Step 1: 创建快捷指令组件**

- 横向滚动的指令卡片，展示常用 skill 触发词
- 点击自动填入输入框
- 数据来源：已安装 skill 的触发词列表

**Step 2: 集成到 ChatInput 上方**

**Step 3: Commit**

```bash
git add mycc-web-react/src/components/QuickActions.tsx
git commit -m "feat: add quick action bar for common skills"
```

---

### Task 10: 会话管理

**Files:**
- Modify: `mycc-web-react/src/components/ChatPage.tsx`
- Create: `mycc-web-react/src/components/SessionList.tsx`

**Step 1: 创建会话列表组件**

- 左侧边栏展示历史对话
- 支持新建会话、切换会话
- 会话标题：取自第一条用户消息

**Step 2: 集成到 ChatPage**

添加侧边栏切换逻辑。

**Step 3: Commit**

```bash
git add mycc-web-react/src/components/SessionList.tsx mycc-web-react/src/components/ChatPage.tsx
git commit -m "feat: add session management sidebar"
```

---

## Phase 5: 联调与验证

### Task 11: 端到端验证

**Step 1: 部署模板到 VPS**

```bash
./mycc-backend/scripts/deploy-templates.sh
```

**Step 2: 注册测试用户，验证 workspace 初始化**

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8613800138099","password":"test123456","nickname":"测试用户"}'

# 验证 VPS 上的文件
ssh armysheng@VPS "sudo ls -la /home/mycc_uXX/workspace/"
ssh armysheng@VPS "sudo cat /home/mycc_uXX/workspace/CLAUDE.md"
```

**Step 3: 启动前端，验证对话体验**

- 工具调用显示为自然语言描述
- 思考过程默认折叠
- Skill 面板可正常展示

**Step 4: 最终 Commit 和 PR**

```bash
git push origin feature/assistant-pack-ui
gh pr create --title "feat: personal assistant pack & frontend UX" --body "$(cat <<'EOF'
## Summary
- 用户注册后自动初始化完整 workspace（记忆体系 + CLAUDE.md + hooks）
- 前端对话体验优化（工具调用自然语言化、思考过程折叠）
- Skill 管理面板（列表/详情/安装/卸载）
- 快捷指令栏和会话管理

## Test plan
- [ ] 注册新用户，验证 workspace 文件结构完整
- [ ] CLAUDE.md 中 {{USERNAME}} 已替换为用户昵称
- [ ] hooks 配置生效，对话时自动注入 status.md
- [ ] 前端工具调用显示为自然语言
- [ ] Skill 面板展示、安装、卸载功能正常
- [ ] 移动端布局正常

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
