#!/usr/bin/env bash
set -u

missing=""
mode="${1:---full}"

if [ "$mode" = "--ready" ]; then
  ready_only=1
elif [ "$mode" = "--full" ] || [ "$mode" = "full" ]; then
  ready_only=0
else
  echo "Usage: template-contract.sh [--ready|--full]" >&2
  exit 64
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    missing="$missing command:$1"
  fi
}

finish_contract() {
  if [ -n "$missing" ]; then
    echo "MyCC assistant sandbox contract missing:$missing" >&2
    exit 42
  fi

  echo "MyCC assistant sandbox contract ok"
}

for cmd in \
  bash sh git node npm python3 pip uv curl sed awk gawk grep find xargs tar gzip rg jq file lsof realpath stat timeout \
  gcc g++ make pkg-config code-server claude ccr Xvfb startxfce4 x11vnc websockify dbus-launch xdpyinfo chromium \
  mycc-start-code-server mycc-start-ccr mycc-start-desktop mycc-health-desktop mycc-register-deliverable; do
  require_command "$cmd"
done

if ! node -e "console.log('mycc-node-ok')" | grep -qx "mycc-node-ok"; then
  missing="$missing node:runtime"
fi

if ! python3 -c "print('mycc-python-ok')" | grep -qx "mycc-python-ok"; then
  missing="$missing python:runtime"
fi

if ! python3 -m pip --version >/dev/null 2>&1; then
  missing="$missing python:pip"
fi

if [ ! -x /opt/mycc/browser-agent/venv/bin/python ]; then
  missing="$missing file:/opt/mycc/browser-agent/venv/bin/python"
fi

if [ ! -f /opt/mycc-agent-runtime/bridge.mjs ]; then
  missing="$missing file:/opt/mycc-agent-runtime/bridge.mjs"
fi

for skill in browser-use browser pdf docx xlsx pptx data-analysis deep-research skill-installer skill-creator; do
  if [ ! -f "/home/mycc/.claude/skills/$skill/SKILL.md" ]; then
    missing="$missing skill:claude:$skill"
  fi
  if [ ! -f "/home/mycc/.mycc/skills/$skill/SKILL.md" ]; then
    missing="$missing skill:mycc:$skill"
  fi
done

if [ "$ready_only" -eq 1 ]; then
  finish_contract
  exit 0
fi

python_contract_dir="$(mktemp -d)"
trap 'rm -rf "$python_contract_dir"' EXIT
if ! python3 -m venv "$python_contract_dir/venv" >/dev/null 2>&1; then
  missing="$missing python:venv"
elif ! "$python_contract_dir/venv/bin/python" -m pip --version >/dev/null 2>&1; then
  missing="$missing python:pip"
elif ! "$python_contract_dir/venv/bin/python" -c "print('mycc-python-ok')" | grep -qx "mycc-python-ok"; then
  missing="$missing python:runtime"
fi

if ! timeout 30s /opt/mycc/browser-agent/venv/bin/python - <<'PY' | grep -qx "mycc-browser-use-ok"; then
import browser_use
import playwright
print("mycc-browser-use-ok")
PY
  missing="$missing python:browser-use"
fi

if ! timeout 30s chromium --version >/dev/null 2>&1; then
  missing="$missing browser:chromium"
fi

if ! timeout 30s ccr -h >/dev/null 2>&1; then
  missing="$missing ccr:help"
fi

if ! timeout 30s claude --version >/dev/null 2>&1; then
  missing="$missing claude:version"
fi

registry_contract_dir="$(mktemp -d)"
if ! MYCC_WORKSPACE_DIR="$registry_contract_dir" timeout 30s mycc-register-deliverable \
  --path /reports/contract-report.md \
  --title "Contract report" \
  --kind report \
  --description "Template contract output" \
  >/dev/null 2>&1; then
  missing="$missing mycc:deliverable-registry"
elif ! jq -e '.deliverables[0].path == "/reports/contract-report.md"' "$registry_contract_dir/.mycc/deliverables.json" >/dev/null 2>&1; then
  missing="$missing mycc:deliverable-registry-json"
fi
rm -rf "$registry_contract_dir"

finish_contract
