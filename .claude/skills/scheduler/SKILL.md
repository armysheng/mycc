---
name: scheduler
description: 定时任务系统。内置在 mycc 后端，自动执行定时任务。触发词："/scheduler"、"定时任务"、"启动定时"、"查看定时"
---

# 定时任务系统

定时任务功能**内置在 mycc 后端**，启动后端后自动生效。

## 触发词

- "/scheduler"
- "定时任务"
- "启动定时"
- "查看定时任务"
- "设置定时任务"

---

## 工作原理

```
mycc 后端启动
    ↓
scheduler 模块自动启动
    ↓
每分钟检查 tasks.md
    ↓
匹配时间 → 调用 Claude 执行任务
    ↓
执行完成 → 记录到 history.md + 发通知
```

**关键点**：
- 定时任务是 mycc 后端的一部分
- 后端运行 = 定时任务运行
- 后端停止 = 定时任务停止

---

## 首次安装 SOP

> 这是给 AI 看的操作流程，AI 自己执行，用户只需要确认。

### Step 1: 检查当前状态

```bash
# 检查 mycc 后端是否在运行
lsof -i :8080 -t
```

如果有输出，说明后端已在运行，跳到 Step 5。

### Step 2: 更新后端代码

```bash
cd /path/to/project/.claude/skills/mycc/scripts
git pull  # 如果是 git 管理的
npm install
```

### Step 3: 创建任务配置

```bash
# 复制模板为正式配置
cp .claude/skills/scheduler/tasks.md.example .claude/skills/scheduler/tasks.md

# 创建空的 history.md
echo "# 定时任务执行记录

> 每次执行任务都会记录在这里

---

| 时间 | 任务 | 状态 |
|------|------|------|" > .claude/skills/scheduler/history.md
```

### Step 4: 启动后端

执行 `/mycc` 启动后端。

### Step 5: 验证定时任务

1. 在 `tasks.md` 添加测试任务：
   ```
   | 每1分钟 | 测试任务 | /tell-me | 发个通知测试一下 |
   ```
2. 等待 1 分钟
3. 收到飞书通知 = 成功
4. 删除测试任务

---

## 升级 SOP（已有用户升级）

> AI 自己执行，用户只需确认。

### Step 1: 保存当前连接信息

```bash
# 读取当前配置，告诉用户
cat .claude/skills/mycc/current.json
```

**告诉用户**：
```
后端需要重启以应用更新。

你的连接信息：
- 配对码：{pairCode}
- 连接码：{routeToken}

重启期间（约 2-5 分钟）小程序/网页会暂时断开。
重启完成后，连接会自动恢复，无需重新配对。

如果超过 5 分钟还没恢复，请回到电脑前检查后端服务。
```

### Step 2: 停止当前后端

```bash
lsof -i :8080 -t | xargs kill
```

### Step 3: 更新代码

```bash
cd .claude/skills/mycc/scripts
git pull  # 如果是 git 管理的
npm install
```

### Step 4: 创建 scheduler 配置（如果没有）

```bash
# 检查是否已有配置
if [ ! -f .claude/skills/scheduler/tasks.md ]; then
  cp .claude/skills/scheduler/tasks.md.example .claude/skills/scheduler/tasks.md
  echo "已创建 tasks.md"
fi

if [ ! -f .claude/skills/scheduler/history.md ]; then
  echo "# 定时任务执行记录

> 每次执行任务都会记录在这里

---

| 时间 | 任务 | 状态 |
|------|------|------|" > .claude/skills/scheduler/history.md
  echo "已创建 history.md"
fi
```

### Step 5: 重启后端

执行 `/mycc` 启动后端。

### Step 6: 验证

1. 读取 `current.json` 确认新的连接信息
2. 告诉用户连接已恢复
3. 可选：添加测试任务验证定时功能

---

## 任务配置

位置：`.claude/skills/scheduler/tasks.md`

### 时间格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 每日 | `HH:MM` | `08:00`、`22:30` |
| 每周 | `周X HH:MM` | `周一 09:00`、`周日 20:00` |
| 一次性 | `YYYY-MM-DD HH:MM` | `2026-02-01 10:00` |
| 间隔 | `每X分钟` / `每X小时` | `每30分钟`、`每2小时` |

### 表格格式

```markdown
| 时间 | 任务 | Skill | 说明 |
|------|------|-------|------|
| 08:00 | 每日初始化 | /morning | 更新日期 |
| 每2小时 | 健康提醒 | /tell-me | 喝水活动 |
| 23:40 | 清理任务 | - | 删除过期一次性任务 |
```

### 注意事项

- **Skill 列**：填 skill 名称（如 `/tell-me`），无特定 skill 填 `-`
- **说明列**：传给 AI 的任务描述，可以写详细需求
- **时间误差**：允许 ±2 分钟
- **间隔任务**：对齐到整点/整分钟（如 每2小时 = 0/2/4/6/8/10/12/14/16/18/20/22 点）

---

## 用户操作

| 用户说 | AI 执行 |
|--------|----------|
| "启动定时任务" | 执行 `/mycc` 启动后端 |
| "停止定时任务" | 停止后端 |
| "查看定时任务" | 读取并显示 tasks.md |
| "添加定时任务 xxx" | 编辑 tasks.md 添加一行 |
| "每天 9 点提醒我 xxx" | 添加 `\| 09:00 \| xxx \| /tell-me \| ... \|` |

---

## 执行历史

位置：`.claude/skills/scheduler/history.md`

自动记录每次任务执行：
- 开始时间
- 任务名称
- 执行状态（成功/失败）

---

## 依赖

定时任务功能需要以下 skill：

| Skill | 用途 | 必须？ |
|-------|------|--------|
| `/tell-me` | 发送飞书通知 | 推荐 |
| `/mycc` | 启动后端 | 必须 |

如果没有 `/tell-me` skill，任务仍可执行，但不会发通知。

---

## 常见问题

**Q: 定时任务没有执行？**
1. 检查后端是否在运行：`lsof -i :8080`
2. 检查 tasks.md 时间格式是否正确
3. 查看 history.md 确认是否有执行记录

**Q: 收不到飞书通知？**
1. 检查 `/tell-me` skill 是否配置正确
2. 检查飞书 webhook 是否有效

**Q: 后端重启后任务会重新执行吗？**
不会。每个时间点只执行一次，重启后不会补执行已过的任务。
