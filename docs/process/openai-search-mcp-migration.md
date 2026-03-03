# OpenAI Search MCP 迁移说明（测试环境）

> 日期：2026-03-03  
> 目标：保留联网搜索能力，去掉 `npx` 冷启动，支持代理 OpenAI 接口

## 方案摘要

1. 提供本地 MCP 服务脚本（stdio）：
- `mycc-backend/mcp/openai-web-search-mcp.mjs`
- 暴露工具：`web_search(query, max_results?)`
- 内部调用 OpenAI Responses API + `web_search` tool

2. 部署脚本：
- `mycc-backend/scripts/deploy-openai-search-mcp.sh`
- 将脚本同步到 VPS：`/opt/mycc/mcp/openai-web-search-mcp.mjs`

3. 用户迁移脚本：
- `mycc-backend/scripts/migrate-mcp-server-openai-search.sh`
  - 批量写入 `~/.claude.json` 的 `projects.<workspace>.mcpServers`
  - 删除旧 `duckduckgo-search` 条目
- `mycc-backend/scripts/migrate-key-test-users-openai-search.sh`
  - 仅迁移指定关键测试用户

## 一次性部署

```bash
cd mycc-backend
chmod +x scripts/deploy-openai-search-mcp.sh \
  scripts/migrate-mcp-server-openai-search.sh \
  scripts/migrate-key-test-users-openai-search.sh

# 1) 部署 MCP server 脚本到 VPS
./scripts/deploy-openai-search-mcp.sh armysheng@34.85.0.184
```

## 全量迁移（测试用户）

```bash
cd mycc-backend
OPENAI_API_KEY="sk-..." \
OPENAI_BASE_URL="http://YOUR_PROXY:PORT/v1" \
OPENAI_SEARCH_MODEL="gpt-4o-mini-search-preview" \
OPENAI_SEARCH_TIMEOUT_MS="30000" \
./scripts/migrate-mcp-server-openai-search.sh "mycc_u*"
```

## 关键测试用户迁移

```bash
cd mycc-backend
OPENAI_API_KEY="sk-..." \
OPENAI_BASE_URL="http://YOUR_PROXY:PORT/v1" \
OPENAI_SEARCH_MODEL="gpt-4o-mini-search-preview" \
./scripts/migrate-key-test-users-openai-search.sh mycc_u2 mycc_u5 mycc_u9
```

## 验证

1. 检查 MCP 配置：
```bash
sudo -u mycc_u2 bash -lc "cat ~/.claude.json | jq '.projects[\"/home/mycc_u2/workspace\"].mcpServers'"
```

2. 检查连接：
```bash
sudo -u mycc_u2 bash -lc "cd /home/mycc_u2/workspace && claude mcp list"
```
- 期望看到 `openai-web-search` 已连接。

3. 实际搜索冒烟：
```bash
sudo -u mycc_u2 bash -lc "cd /home/mycc_u2/workspace && claude --print '请搜索今天 AI 领域三条新闻并附链接'"
```

## 回滚

1. 用户配置回滚：
- 使用 `~/.claude.json.bak-*` 恢复。

2. 切回 Duck：
- 运行 `scripts/migrate-mcp-server-duckduckgo.sh` 重新注入旧配置。

## 注意事项

1. `OPENAI_API_KEY` 会写入用户 `~/.claude.json`，仅用于测试环境。生产建议改为统一密钥注入方案（例如启动 wrapper 进程读取 root-only env 文件）。
2. 若代理仍走旧协议，可设置：
- `OPENAI_SEARCH_TOOL_TYPE=web_search_preview`
3. 该 MCP 已内置超时：
- `OPENAI_SEARCH_TIMEOUT_MS`（默认 45s）
