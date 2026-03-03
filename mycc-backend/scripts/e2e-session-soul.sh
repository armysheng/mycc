#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TMP_DIR="${TMP_DIR:-$(mktemp -d /tmp/mycc-session-soul-e2e.XXXXXX)}"
CURL_OPTS=(--connect-timeout 3 --max-time 25 -sS)

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

timestamp="$(date +%s)"
phone="+8613900${timestamp: -6}"
password="E2ePass!123"
nickname="e2e-soul-${timestamp: -4}"

echo "[E2E] register user: $phone"
register_resp="$TMP_DIR/register.json"
if ! curl "${CURL_OPTS[@]}" "$BASE_URL/health" >/dev/null; then
  echo "[E2E][FAIL] backend not reachable: $BASE_URL"
  exit 1
fi

curl "${CURL_OPTS[@]}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$phone\",\"password\":\"$password\",\"nickname\":\"$nickname\"}" \
  > "$register_resp"

TOKEN="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d?.data?.token||'');" "$register_resp")"
if [[ -z "$TOKEN" ]]; then
  echo "[E2E][FAIL] register token empty"
  cat "$register_resp"
  exit 1
fi

auth_header="Authorization: Bearer $TOKEN"

echo "[E2E] check identity"
identity_resp="$TMP_DIR/identity.json"
curl "${CURL_OPTS[@]}" "$BASE_URL/api/chat/identity" \
  -H "$auth_header" \
  > "$identity_resp"

node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
if(!d?.success) throw new Error('identity failed');
if(!d?.data?.identityId) throw new Error('identityId missing');
if(!d?.data?.soulId) throw new Error('soulId missing');
console.log('[E2E] identity:', d.data.identityId, d.data.soulId);
" "$identity_resp"

echo "[E2E] write memory"
memory_text="偏好：先结论后细节；代码示例尽量最小。"
curl "${CURL_OPTS[@]}" -X PUT "$BASE_URL/api/chat/memory" \
  -H "$auth_header" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$memory_text\"}" \
  > "$TMP_DIR/memory_put.json"

echo "[E2E] read memory"
curl "${CURL_OPTS[@]}" "$BASE_URL/api/chat/memory" \
  -H "$auth_header" \
  > "$TMP_DIR/memory_get.json"

node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
if(!d?.success) throw new Error('memory read failed');
if(!String(d?.data?.content||'').includes('先结论后细节')) throw new Error('memory content mismatch');
console.log('[E2E] memory chars=', d?.data?.chars);
" "$TMP_DIR/memory_get.json"
echo "[E2E][PASS] identity + memory API"
