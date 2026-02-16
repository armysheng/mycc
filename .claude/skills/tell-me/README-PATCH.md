# Tell-Me 本地改动恢复

拉取新版本后，如果富文本功能被覆盖，执行以下命令恢复：

```bash
cd .claude/skills/tell-me
git apply local-changes.patch
```

**包含改动**：
- 富文本格式支持（标题、列表、按钮等）
- config.json 读取方式
- Windows 命令行 \n 转义处理
