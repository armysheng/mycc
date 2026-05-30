#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$BACKEND_DIR/templates/e2b-code-server"
TEMPLATE_NAME="${MYCC_E2B_TEMPLATE:-mycc-code-server-dev}"
CPU_COUNT="${MYCC_E2B_TEMPLATE_CPU_COUNT:-2}"
MEMORY_MB="${MYCC_E2B_TEMPLATE_MEMORY_MB:-4096}"

READY_CMD='code-server --version && node --version && npm --version && claude --version && cd /opt/mycc-agent-runtime && node -e "import(\"@anthropic-ai/claude-agent-sdk\").then(() => console.log(\"agent-sdk ok\"))" && test -f /opt/mycc-agent-runtime/bridge.mjs && rg --version && jq --version && file --version && git --version && python3 --version && gcc --version && make --version && find --version && gawk --version && lsof -v && tree --version'

if [[ -z "${E2B_ACCESS_TOKEN:-}" ]]; then
  auth_info="$(npx --yes @e2b/cli auth info 2>&1 || true)"
  if grep -qi 'not logged in' <<<"$auth_info"; then
    cat >&2 <<'EOF'
[error] E2B CLI is not logged in.
Set E2B_ACCESS_TOKEN from https://e2b.dev/dashboard?tab=personal or run:
  npx --yes @e2b/cli auth login
EOF
    exit 1
  fi
fi

cd "$TEMPLATE_DIR"
npx --yes @e2b/cli template create "$TEMPLATE_NAME" \
  --path . \
  --dockerfile e2b.Dockerfile \
  --cpu-count "$CPU_COUNT" \
  --memory-mb "$MEMORY_MB" \
  --ready-cmd "$READY_CMD"
