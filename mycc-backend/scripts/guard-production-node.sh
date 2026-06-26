#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${MYCC_SYSTEMD_SERVICE:-mycc-backend.service}"
DEFAULT_NODE_BIN_DIR="${MYCC_NODE_BIN_DIR:-/home/armysheng/.local/node-v20.19.5-linux-x64/bin}"
EXPECTED_NODE_VERSION="${MYCC_EXPECTED_NODE_VERSION:-v20.19.5}"

usage() {
  cat <<EOF
Usage: $0 [--print-bin-dir]

Checks that PATH node/npm match the Node toolchain used by the systemd service.

Environment:
  MYCC_SYSTEMD_SERVICE         systemd service name (default: mycc-backend.service)
  MYCC_SYSTEMD_UNIT            unit file to read instead of systemctl or default unit paths
  MYCC_NODE_BIN_DIR            fallback service Node bin dir (default: $DEFAULT_NODE_BIN_DIR)
  MYCC_EXPECTED_NODE_VERSION   expected Node version (default: $EXPECTED_NODE_VERSION)
EOF
}

extract_execstart_node() {
  awk '
    /^[[:space:]]*ExecStart=/ {
      line = $0
      sub(/^[[:space:]]*ExecStart=/, "", line)
      sub(/^[[:space:]]+/, "", line)
      sub(/^[-+!@:]+/, "", line)

      if (line ~ /^"/) {
        sub(/^"/, "", line)
        sub(/".*$/, "", line)
        print line
        exit
      }

      split(line, parts, /[[:space:]]+/)
      print parts[1]
      exit
    }
  '
}

read_unit() {
  if [[ -n "${MYCC_SYSTEMD_UNIT:-}" ]]; then
    [[ -r "$MYCC_SYSTEMD_UNIT" ]] && cat "$MYCC_SYSTEMD_UNIT"
    return 0
  fi

  local unit_path="/etc/systemd/system/$SERVICE_NAME"
  if [[ -r "$unit_path" ]]; then
    cat "$unit_path"
    return 0
  fi

  local user_unit_path="${HOME:-}/.config/systemd/user/$SERVICE_NAME"
  if [[ -n "$user_unit_path" && -r "$user_unit_path" ]]; then
    cat "$user_unit_path"
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user cat "$SERVICE_NAME" 2>/dev/null || systemctl cat "$SERVICE_NAME" 2>/dev/null || true
  fi
}

service_node_path() {
  local from_unit
  from_unit="$(read_unit | extract_execstart_node || true)"

  if [[ -n "$from_unit" ]]; then
    printf '%s\n' "$from_unit"
    return 0
  fi

  printf '%s/node\n' "$DEFAULT_NODE_BIN_DIR"
}

resolve_path() {
  local path="$1"

  if [[ -z "$path" ]]; then
    return 0
  fi

  if command -v realpath >/dev/null 2>&1; then
    realpath "$path" 2>/dev/null || printf '%s\n' "$path"
    return 0
  fi

  local dir base
  dir="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || {
    printf '%s\n' "$path"
    return 0
  }
  base="$(basename "$path")"
  printf '%s/%s\n' "$dir" "$base"
}

version_or_error() {
  local label="$1"
  shift

  "$@" 2>/dev/null || printf '<error: %s failed>\n' "$label"
}

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    return 0
  fi

  local service_node service_node_dir service_npm
  service_node="$(service_node_path)"
  service_node_dir="$(dirname "$service_node")"
  service_npm="$service_node_dir/npm"

  if [[ "${1:-}" == "--print-bin-dir" ]]; then
    printf '%s\n' "$service_node_dir"
    return 0
  fi

  if [[ -n "${1:-}" ]]; then
    usage >&2
    return 2
  fi

  local path_node path_npm
  path_node="$(command -v node || true)"
  path_npm="$(command -v npm || true)"

  local service_node_version service_npm_version path_node_version path_npm_version
  service_node_version="$(version_or_error "systemd node -v" "$service_node" -v)"
  service_npm_version="$(PATH="$service_node_dir:$PATH" version_or_error "systemd npm -v" "$service_npm" -v)"
  path_node_version="$(version_or_error "node -v" node -v)"
  path_npm_version="$(version_or_error "npm -v" npm -v)"

  echo "Production Node guard"
  echo "systemd service: $SERVICE_NAME"
  echo "expected node: $EXPECTED_NODE_VERSION"
  echo "systemd node: $service_node"
  echo "systemd npm: $service_npm"
  echo "which node: ${path_node:-<missing>}"
  echo "which npm: ${path_npm:-<missing>}"
  echo "systemd node -v: $service_node_version"
  echo "systemd npm -v: $service_npm_version"
  echo "node -v: $path_node_version"
  echo "npm -v: $path_npm_version"

  local failed=0
  report_error() {
    echo "ERROR: $*" >&2
    failed=1
  }

  [[ -x "$service_node" ]] || report_error "systemd node is not executable: $service_node"
  [[ -x "$service_npm" ]] || report_error "systemd npm is not executable: $service_npm"
  [[ -n "$path_node" ]] || report_error "node is not present on PATH"
  [[ -n "$path_npm" ]] || report_error "npm is not present on PATH"

  local service_node_resolved service_npm_resolved path_node_resolved path_npm_resolved
  service_node_resolved="$(resolve_path "$service_node")"
  service_npm_resolved="$(resolve_path "$service_npm")"
  path_node_resolved="$(resolve_path "$path_node")"
  path_npm_resolved="$(resolve_path "$path_npm")"

  [[ "$path_node_resolved" == "$service_node_resolved" ]] || report_error "PATH node does not match systemd node"
  [[ "$path_npm_resolved" == "$service_npm_resolved" ]] || report_error "PATH npm does not match systemd npm"
  [[ "$service_node_version" == "$EXPECTED_NODE_VERSION" ]] || report_error "systemd node version is $service_node_version, expected $EXPECTED_NODE_VERSION"
  [[ "$path_node_version" == "$EXPECTED_NODE_VERSION" ]] || report_error "PATH node version is $path_node_version, expected $EXPECTED_NODE_VERSION"
  [[ "$path_npm_version" == "$service_npm_version" ]] || report_error "PATH npm version does not match systemd npm version"

  if [[ "$failed" -ne 0 ]]; then
    echo "Refusing to continue: production Node toolchain is not aligned with systemd." >&2
    return 1
  fi

  echo "OK: production Node toolchain matches systemd."
}

main "$@"
