# Obsidian API Skill

通过 Obsidian Local REST API 插件直接操作知识库笔记。

## 触发词

- "帮我记录到 Obsidian"
- "保存到知识库"
- "创建笔记"
- "读取笔记 xxx"

---

## 功能

- **创建笔记** — 在指定目录创建新笔记
- **读取笔记** — 获取笔记内容
- **更新笔记** — 修改现有笔记
- **列出目录** — 查看目录下的文件
- **搜索笔记** — 按文件名搜索

---

## 配置

```bash
OBSIDIAN_API_URL=https://127.0.0.1:27124
OBSIDIAN_API_KEY=63b2fc8cfcd49d66486cab083c676cf22816fd271f8315d0b3461a33108f8c8f
```

---

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/vault/` | 列出根目录 |
| GET | `/vault/{path}` | 读取笔记/目录 |
| PUT | `/vault/{path}` | 创建/更新笔记 |
| DELETE | `/vault/{path}` | 删除笔记 |
| PATCH | `/vault/{path}` | 部分更新笔记 |

---

## 使用示例

### 列出目录
```bash
curl -k "https://127.0.0.1:27124/vault/" \
  -H "Authorization: Bearer 63b2fc8cfcd49d66486cab083c676cf22816fd271f8315d0b3461a33108f8c8f"
```

### 读取笔记
```bash
curl -k "https://127.0.0.1:27124/vault/AGENTS.md" \
  -H "Authorization: Bearer 63b2fc8cfcd49d66486cab083c676cf22816fd271f8315d0b3461a33108f8c8f"
```

### 创建笔记
```bash
curl -k -X PUT "https://127.0.0.1:27124/vault/myk/调研笔记/test.md" \
  -H "Authorization: Bearer 63b2fc8cfcd49d66486cab083c676cf22816fd271f8315d0b3461a33108f8c8f" \
  -H "Content-Type: text/markdown" \
  -d "# Test\n\n内容"
```

---

## 注意事项

- 需要 Obsidian Local REST API 插件运行
- 使用 HTTPS 自签名证书，需要 `-k` 参数
- 知识库路径：`E:\AI\Obsidian\data\记忆`

---

*创建：2026-02-04*
