# 记忆系统 (Memory System)

> 基于 Obsidian 的四层 AI 记忆管理，让 AI 越用越懂你。

---

## 功能

### 四层记忆

| 层级 | 存储 | 生命周期 | 说明 |
|------|------|----------|------|
| 长期记忆 | `.memory/long/` | 永久 | 偏好、习惯、工作流程 |
| 短期记忆 | `.memory/short/` | 会话级 | 当前对话上下文 |
| 向量记忆 | `.memory/vectordb/` | 永久 | 语义检索（预留） |
| 快照 | `.memory/snapshot.md` | 自动 | 聚合长期记忆，一次读完 |

---

## 使用方式

### 1. recall — 检索记忆

**触发词**：
- "回忆一下 xxx"
- "查查记忆"
- "我记得你说过 xxx"

**示例**：
```
我：回忆一下我的偏好
cc：检索记忆...（读取 .memory/long/ 中的偏好文件）
```

### 2. remember — 记到短期记忆

**触发词**：
- "记一下 xxx"
- "记住这个"
- "先存起来"

**示例**：
```
我：记一下，我喜欢简洁风格
cc：✓ 已记到短期记忆: 我喜欢简洁风格
```

### 3. consolidate — 沉淀到长期记忆

**触发词**：
- "以后都这样"
- "沉淀一下"
- "写到长期记忆"

**示例**：
```
我：以后都用简洁风格
cc：✓ 已沉淀到长期记忆[preferences]: 以后都用简洁风格
```

### 4. forget — 清理记忆

**触发词**：
- "忘掉 xxx"
- "清理一下记忆"
- "这个记错了"

**示例**：
```
我：忘掉那个错误的配置
cc：✓ 已清理包含 '错误的配置' 的记忆
```

### 5. snapshot — 生成快照

**触发词**：
- "生成记忆快照"
- "整理一下记忆"

**用途**：将长期记忆聚合到一个文件，AI 启动时一次读完。

---

## 双链功能

### 6. backlink — 查找反向链接

**触发词**：
- "谁链接了 xxx"
- "反向链接 xxx"
- "哪些笔记提到了 xxx"

**示例**：
```
我：谁链接了 Obsidian插件开发
cc：搜索中...找到 2 个反向链接：
  - myk/技术沉淀/Obsidian技巧.md
  - AGENTS.md
```

### 7. link — 记忆并链接

**触发词**：
- "记一下并链接到 xxx"
- "关联到 xxx 笔记"

**示例**：
```
我：记一下，插件开发要注意热重载，链接到 Obsidian插件开发
cc：✓ 已记忆并链接到 [[Obsidian插件开发]]
```

### 8. search — 搜索知识库

**触发词**：
- "搜索 xxx"
- "查找 xxx"
- "知识库里有 xxx 吗"

**示例**：
```
我：搜索插件
cc：找到 3 个相关笔记：
  - myk/调研笔记/Obsidian插件开发.md
  - myk/技术沉淀/插件最佳实践.md
  - AGENTS.md
```

---

## 目录结构

```
.memory/
├── long/                    # 长期记忆
│   ├── preferences.md       # 使用偏好
│   ├── habits.md           # 工作习惯
│   └── workflows.md        # 工作流程
├── short/                   # 短期记忆
│   ├── session.md          # 当前会话
│   └── recent.md           # 最近记录
├── vectordb/               # 向量记忆（预留）
│   └── chroma.sqlite3      # 本地向量库
└── snapshot.md             # 记忆快照
```

---

## 配置

### 环境变量

```bash
# 设置记忆库路径（可选，默认为 E:/AI/Obsidian/data/记忆/.memory）
export MEMORY_PATH="你的路径"
```

### 在 AGENTS.md 中集成

```markdown
## 记忆系统

每次启动时：
1. 读取 .memory/snapshot.md（快照）
2. 检索相关记忆（recall）

对话过程中：
- "记一下 xxx" → remember
- "以后都这样" → consolidate
- "忘掉 xxx" → forget

对话结束时：
- 更新快照（snapshot）
```

---

## 技术实现

### Python 脚本

```bash
# 检索记忆
python scripts/memory.py recall [query]

# 记到短期
python scripts/memory.py remember "内容"

# 沉淀到长期
python scripts/memory.py consolidate "内容" [category]

# 清理记忆
python scripts/memory.py forget "pattern"

# 生成快照
python scripts/memory.py snapshot
```

### 记忆格式

```markdown
## 2026-02-04 14:30:00
我喜欢简洁直接的风格，不要废话。

## 2026-02-04 15:20:00
技术沉淀前必须先确认。
```

---

## 扩展方向

### 向量检索（未来）

使用 ChromaDB 实现语义检索：
- "Q弹风格" → 找到 "水晶材质"
- "不用注释" → 找到 "代码风格偏好"

### 自动学习（未来）

AI 观察用户行为，自动沉淀：
- 说了三次"别用注释" → 自动记入 habits.md
- 指出"风格不对" → 自动检查并更新 preferences.md

### 过期管理（未来）

- 时间衰减：越久的记忆权重越低
- 过时标记：`[已过时]` 但保留历史
- 重要性评分：常用知识权重高

---

## 基于文章设计

本 Skill 基于公众号文章《玩转 OpenCode(六)：搭个知识库，让AI帮我记东西，打造第二大脑！》设计。

核心思想：
- **AI 帮我记，我只管用**
- **调研一次，永久可用**
- **越用越懂你**

---

*创建：2026-02-04*
