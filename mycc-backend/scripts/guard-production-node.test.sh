#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/guard-production-node.sh"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"

  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain:\n%s\n\nActual output:\n%s\n' "$needle" "$haystack" >&2
    fail "missing expected output"
  fi
}

make_fake_node_bin() {
  local bin_dir="$1"
  local node_version="$2"
  local npm_version="$3"

  mkdir -p "$bin_dir"
  {
    echo '#!/usr/bin/env bash'
    printf 'printf "%%s\\n" %q\n' "$node_version"
  } > "$bin_dir/node"
  {
    echo '#!/usr/bin/env bash'
    printf 'printf "%%s\\n" %q\n' "$npm_version"
  } > "$bin_dir/npm"
  chmod +x "$bin_dir/node" "$bin_dir/npm"
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

SERVICE_BIN="$TMP_ROOT/service-node/bin"
WRONG_BIN="$TMP_ROOT/path-node/bin"
UNIT_FILE="$TMP_ROOT/mycc-backend.service"

make_fake_node_bin "$SERVICE_BIN" "v20.19.5" "10.8.2"
make_fake_node_bin "$WRONG_BIN" "v22.19.0" "10.9.0"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Fake MyCC Backend

[Service]
WorkingDirectory=/tmp/mycc-backend
ExecStart=$SERVICE_BIN/node dist/index.js
EOF

actual_bin_dir="$(MYCC_SYSTEMD_UNIT="$UNIT_FILE" "$GUARD" --print-bin-dir)"
[[ "$actual_bin_dir" == "$SERVICE_BIN" ]] || fail "expected systemd node bin dir"

output="$(PATH="$SERVICE_BIN:/usr/bin:/bin" MYCC_SYSTEMD_UNIT="$UNIT_FILE" MYCC_EXPECTED_NODE_VERSION="v20.19.5" "$GUARD" 2>&1)"
assert_contains "$output" "systemd node: $SERVICE_BIN/node"
assert_contains "$output" "systemd npm: $SERVICE_BIN/npm"
assert_contains "$output" "which node: $SERVICE_BIN/node"
assert_contains "$output" "which npm: $SERVICE_BIN/npm"
assert_contains "$output" "node -v: v20.19.5"
assert_contains "$output" "npm -v: 10.8.2"

set +e
output="$(PATH="$WRONG_BIN:$SERVICE_BIN:/usr/bin:/bin" MYCC_SYSTEMD_UNIT="$UNIT_FILE" MYCC_EXPECTED_NODE_VERSION="v20.19.5" "$GUARD" 2>&1)"
status=$?
set -e

[[ "$status" -ne 0 ]] || fail "guard should fail when PATH node differs from systemd node"
assert_contains "$output" "ERROR: PATH node does not match systemd node"
assert_contains "$output" "which node: $WRONG_BIN/node"
assert_contains "$output" "systemd node: $SERVICE_BIN/node"

echo "ok - guard-production-node"
