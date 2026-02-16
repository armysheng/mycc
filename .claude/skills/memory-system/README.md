# Memory System Skill

基于 Obsidian 的四层 AI 记忆管理系统。

## 功能

- **recall** — 检索相关记忆
- **remember** — 存入短期记忆
- **consolidate** — 沉淀到长期记忆
- **forget** — 清理过期记忆
- **snapshot** — 生成记忆快照

## 使用

```bash
python scripts/memory.py recall [query]
python scripts/memory.py remember "内容"
python scripts/memory.py consolidate "内容" [category]
python scripts/memory.py forget "pattern"
python scripts/memory.py snapshot
```

## 目录

```
.memory/
├── long/           # 长期记忆（偏好、习惯、流程）
├── short/          # 短期记忆（会话级）
├── vectordb/       # 向量记忆（语义检索）
└── snapshot.md     # 记忆快照
```
