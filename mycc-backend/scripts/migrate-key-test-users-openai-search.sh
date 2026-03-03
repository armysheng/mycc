#!/usr/bin/env bash
set -euo pipefail

# 仅迁移关键测试用户到 OpenAI Search MCP。
#
# Usage:
#   OPENAI_API_KEY=... ./scripts/migrate-key-test-users-openai-search.sh mycc_u2 mycc_u7 mycc_u9

if [[ $# -lt 1 ]]; then
  echo "Usage: OPENAI_API_KEY=... $0 mycc_u2 [mycc_u7 ...]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for user in "$@"; do
  echo "[INFO] migrating $user"
  "$SCRIPT_DIR/migrate-mcp-server-openai-search.sh" "$user" "openai-web-search"
done

echo "[OK] key users migrated: $*"
