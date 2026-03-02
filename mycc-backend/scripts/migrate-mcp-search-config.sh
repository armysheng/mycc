#!/usr/bin/env bash
set -euo pipefail

# 批量迁移 mycc 测试用户的 Claude 本地设置：
# 1) 禁用内置 WebSearch（避免走不稳定代理链路）
# 2) 清理误写到 settings.local.json 的 mcpServers（MCP 正确位置在 ~/.claude.json）

USER_GLOB="${1:-mycc_u*}"
STAMP="$(date +%Y%m%d-%H%M%S)"
export USER_GLOB STAMP

python3 - <<'PY'
import glob
import json
import os
from datetime import datetime

user_glob = os.environ.get("USER_GLOB", "mycc_u*")
stamp = os.environ.get("STAMP", datetime.now().strftime("%Y%m%d-%H%M%S"))
paths = sorted(glob.glob(f"/home/{user_glob}/workspace/.claude/settings.local.json"))

changed = 0
skipped = 0
errors = []

for path in paths:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("root is not object")

        permissions = data.setdefault("permissions", {})
        if not isinstance(permissions, dict):
            permissions = {}
            data["permissions"] = permissions
        for key in ("allow", "deny", "ask"):
            v = permissions.get(key)
            if not isinstance(v, list):
                permissions[key] = []

        if "WebSearch" not in permissions["deny"]:
            permissions["deny"].append("WebSearch")

        before = json.dumps(data, ensure_ascii=False, sort_keys=True)
        if isinstance(data.get("mcpServers"), dict):
            data["mcpServers"].pop("duckduckgo-search", None)
            if len(data["mcpServers"]) == 0:
                data.pop("mcpServers", None)
        after = json.dumps(data, ensure_ascii=False, sort_keys=True)

        if before == after:
            skipped += 1
            continue

        backup = f"{path}.bak-{stamp}"
        with open(path, "r", encoding="utf-8") as f:
            original = f.read()
        with open(backup, "w", encoding="utf-8") as f:
            f.write(original)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")

        changed += 1
        print(f"[UPDATED] {path}")
    except Exception as e:
        errors.append((path, str(e)))
        print(f"[ERROR] {path}: {e}")

print(f"[SUMMARY] total={len(paths)} changed={changed} skipped={skipped} errors={len(errors)}")
if errors:
    raise SystemExit(1)
PY
