#!/usr/bin/env bash
set -euo pipefail

# 批量迁移用户到 OpenAI Search MCP。
#
# Usage:
#   OPENAI_API_KEY=... ./scripts/migrate-mcp-server-openai-search.sh [USER_GLOB] [SERVER_NAME]
#
# Optional env:
#   OPENAI_BASE_URL
#   OPENAI_SEARCH_MODEL
#   OPENAI_SEARCH_TOOL_TYPE
#   OPENAI_SEARCH_TIMEOUT_MS
#   OPENAI_SEARCH_EXTERNAL_WEB_ACCESS
#   OPENAI_SEARCH_COMMAND (default: node)
#   OPENAI_SEARCH_SERVER_PATH (default: /opt/mycc/mcp/openai-web-search-mcp.mjs)

USER_GLOB="${1:-mycc_u*}"
SERVER_NAME="${2:-openai-web-search}"
STAMP="$(date +%Y%m%d-%H%M%S)"
export USER_GLOB SERVER_NAME STAMP

python3 - <<'PY'
import glob
import json
import os
from datetime import datetime

user_glob = os.environ.get("USER_GLOB", "mycc_u*")
server_name = os.environ.get("SERVER_NAME", "openai-web-search")
stamp = os.environ.get("STAMP", datetime.now().strftime("%Y%m%d-%H%M%S"))

openai_api_key = os.environ.get("OPENAI_API_KEY", "")
openai_base_url = os.environ.get("OPENAI_BASE_URL", "")
search_model = os.environ.get("OPENAI_SEARCH_MODEL", "")
search_tool_type = os.environ.get("OPENAI_SEARCH_TOOL_TYPE", "")
search_timeout = os.environ.get("OPENAI_SEARCH_TIMEOUT_MS", "")
external_web_access = os.environ.get("OPENAI_SEARCH_EXTERNAL_WEB_ACCESS", "")
search_command = os.environ.get("OPENAI_SEARCH_COMMAND", "node")
server_path = os.environ.get(
    "OPENAI_SEARCH_SERVER_PATH", "/opt/mycc/mcp/openai-web-search-mcp.mjs"
)

if not openai_api_key:
    raise SystemExit("[ERROR] OPENAI_API_KEY is required")

homes = sorted(glob.glob(f"/home/{user_glob}"))
total = 0
changed = 0
skipped = 0
errors = []

for home in homes:
    user = os.path.basename(home)
    workspace = f"{home}/workspace"
    if not os.path.isdir(workspace):
        continue
    total += 1
    config_path = f"{home}/.claude.json"

    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                data = {}
        else:
            data = {}

        projects = data.setdefault("projects", {})
        if not isinstance(projects, dict):
            projects = {}
            data["projects"] = projects

        project = projects.setdefault(workspace, {})
        if not isinstance(project, dict):
            project = {}
            projects[workspace] = project

        mcp_servers = project.setdefault("mcpServers", {})
        if not isinstance(mcp_servers, dict):
            mcp_servers = {}
            project["mcpServers"] = mcp_servers

        before = json.dumps(data, ensure_ascii=False, sort_keys=True)

        # 清理旧 duck 配置，避免同类工具冲突。
        mcp_servers.pop("duckduckgo-search", None)

        env = {
            "OPENAI_API_KEY": openai_api_key,
        }
        if openai_base_url:
            env["OPENAI_BASE_URL"] = openai_base_url
        if search_model:
            env["OPENAI_SEARCH_MODEL"] = search_model
        if search_tool_type:
            env["OPENAI_SEARCH_TOOL_TYPE"] = search_tool_type
        if search_timeout:
            env["OPENAI_SEARCH_TIMEOUT_MS"] = search_timeout
        if external_web_access:
            env["OPENAI_SEARCH_EXTERNAL_WEB_ACCESS"] = external_web_access

        mcp_servers[server_name] = {
            "type": "stdio",
            "command": search_command,
            "args": [server_path],
            "env": env,
        }

        after = json.dumps(data, ensure_ascii=False, sort_keys=True)
        if before == after:
            skipped += 1
            continue

        if os.path.exists(config_path):
            backup = f"{config_path}.bak-{stamp}"
            with open(config_path, "r", encoding="utf-8") as f:
                original = f.read()
            with open(backup, "w", encoding="utf-8") as f:
                f.write(original)

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")

        changed += 1
        print(f"[UPDATED] {user} -> {config_path}")
    except Exception as e:
        errors.append((user, str(e)))
        print(f"[ERROR] {user}: {e}")

print(f"[SUMMARY] users={total} changed={changed} skipped={skipped} errors={len(errors)}")
if errors:
    raise SystemExit(1)
PY
