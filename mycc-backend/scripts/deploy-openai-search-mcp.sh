#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${1:-armysheng@34.85.0.184}"
REMOTE_DIR="${2:-/opt/mycc/mcp}"
LOCAL_FILE="$(dirname "$0")/../mcp/openai-web-search-mcp.mjs"
REMOTE_FILE="$REMOTE_DIR/openai-web-search-mcp.mjs"

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "[ERROR] local file not found: $LOCAL_FILE"
  exit 1
fi

echo "[INFO] deploy to $VPS_HOST:$REMOTE_FILE"
ssh "$VPS_HOST" "sudo mkdir -p '$REMOTE_DIR'"
scp "$LOCAL_FILE" "$VPS_HOST:/tmp/openai-web-search-mcp.mjs"
ssh "$VPS_HOST" "sudo mv /tmp/openai-web-search-mcp.mjs '$REMOTE_FILE' && sudo chmod 755 '$REMOTE_FILE'"
ssh "$VPS_HOST" "node --version && ls -l '$REMOTE_FILE'"

echo "[OK] deployed: $REMOTE_FILE"
