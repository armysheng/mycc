#!/usr/bin/env bash
set -euo pipefail

# 批量给 mycc 用户写入 DuckDuckGo MCP（正确位置：~/.claude.json 的 projects 节点）

USER_GLOB="${1:-mycc_u*}"
SERVER_NAME="${2:-duckduckgo-search}"
STAMP="$(date +%Y%m%d-%H%M%S)"
export USER_GLOB SERVER_NAME STAMP

python3 - <<'PY'
import glob
import json
import os
from datetime import datetime

user_glob = os.environ.get("USER_GLOB", "mycc_u*")
server_name = os.environ.get("SERVER_NAME", "duckduckgo-search")
stamp = os.environ.get("STAMP", datetime.now().strftime("%Y%m%d-%H%M%S"))

homes = sorted(glob.glob(f"/home/{user_glob}"))
total = 0
changed = 0
skipped = 0
errors = []

server_conf = {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "duckduckgo-mcp-server"],
    "env": {},
}

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
        mcp_servers[server_name] = server_conf
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

