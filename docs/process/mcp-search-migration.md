# MCP 搜索迁移（测试环境，Duck 版本）

> 日期：2026-03-02  
> 目标：停用不稳定的内置 `WebSearch`，统一切到免费 `DuckDuckGo MCP`

> 说明：2026-03-03 起新增 OpenAI 方案，见
> `docs/process/openai-search-mcp-migration.md`

## 变更内容

1. 新用户模板（`mycc-backend/templates/user-workspace/.claude/settings.local.json`）
- 默认 `permissions.deny` 增加 `WebSearch`
- 保留原有 `UserPromptSubmit` hook

2. 存量用户迁移脚本
- `mycc-backend/scripts/migrate-mcp-search-config.sh`
  - 给 `workspace/.claude/settings.local.json` 增加 `deny: ["WebSearch"]`
  - 清理误写的 `mcpServers.duckduckgo-search`（MCP 不应写在此文件）
- `mycc-backend/scripts/migrate-mcp-server-duckduckgo.sh`
  - 在 `~/.claude.json` 的 `projects.<workspace>.mcpServers` 注入：
  - `duckduckgo-search -> npx -y duckduckgo-mcp-server`

## 执行顺序（建议）

```bash
cd mycc-backend
./scripts/deploy-templates.sh armysheng@34.85.0.184
./scripts/migrate-mcp-search-config.sh mycc_u*
./scripts/migrate-mcp-server-duckduckgo.sh mycc_u*
```

## 验证方法

1. 抽样检查本地设置：
```bash
cat /home/mycc_u2/workspace/.claude/settings.local.json
```
- 期望包含 `"deny": ["WebSearch"]`

2. 抽样检查 MCP：
```bash
sudo -u mycc_u2 bash -lc "cd /home/mycc_u2/workspace && claude mcp list"
```
- 期望输出 `duckduckgo-search ... Connected`

## 回滚

1. `settings.local.json` 回滚
- 使用同目录自动备份：`settings.local.json.bak-*`

2. `~/.claude.json` 回滚
- 使用同目录自动备份：`.claude.json.bak-*`
