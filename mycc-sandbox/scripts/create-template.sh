#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$SANDBOX_DIR/templates/e2b-assistant-sandbox"

TEMPLATE_NAME="${MYCC_SANDBOX_TEMPLATE:-mycc-assistant-sandbox-dev}"
CPU_COUNT="${MYCC_SANDBOX_TEMPLATE_CPU_COUNT:-4}"
MEMORY_MB="${MYCC_SANDBOX_TEMPLATE_MEMORY_MB:-8192}"
READY_CMD='/opt/mycc/contracts/template-contract.sh --ready'

if [[ -z "${E2B_ACCESS_TOKEN:-}" ]]; then
  auth_info="$(npx --yes @e2b/cli auth info 2>&1 || true)"
  if grep -qi 'not logged in' <<<"$auth_info"; then
    cat >&2 <<'EOF'
[error] E2B CLI is not logged in.
Set E2B_ACCESS_TOKEN from the E2B dashboard or run:
  npx --yes @e2b/cli auth login
EOF
    exit 1
  fi
fi

cd "$TEMPLATE_DIR"
npx --yes @e2b/cli template create "$TEMPLATE_NAME" \
  --path . \
  --dockerfile Dockerfile \
  --cpu-count "$CPU_COUNT" \
  --memory-mb "$MEMORY_MB" \
  --ready-cmd "$READY_CMD"
