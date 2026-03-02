#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TMP_DIR="${TMP_DIR:-$(mktemp -d /tmp/mycc-session-soul-e2e.XXXXXX)}"
RUN_CHAT_E2E="${RUN_CHAT_E2E:-0}"
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
console.log('[E2E] identity:', d.data.identityId, d.data.soulId, 'scope='+d.data.dmScope);
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

if [[ "$RUN_CHAT_E2E" != "1" ]]; then
  echo "[E2E] skip chat session merge check (set RUN_CHAT_E2E=1 to enable)"
  echo "[E2E][PASS] identity + memory API"
  exit 0
fi

echo "[E2E] run chat #1"
chat1_raw="$TMP_DIR/chat1.sse"
curl "${CURL_OPTS[@]}" -N -X POST "$BASE_URL/api/chat" \
  -H "$auth_header" \
  -H "Content-Type: application/json" \
  -d '{"message":"只回复 pong"}' > "$chat1_raw"

done1_json="$(awk -F'data: ' '/"type":"done"/{print $2}' "$chat1_raw" | tail -n1)"
if [[ -z "$done1_json" ]]; then
  echo "[E2E][FAIL] chat #1 missing done event"
  cat "$chat1_raw"
  exit 1
fi
sid1="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.sessionId||''));" "$done1_json")"
if [[ -z "$sid1" ]]; then
  echo "[E2E][FAIL] chat #1 sessionId empty"
  cat "$chat1_raw"
  exit 1
fi

echo "[E2E] run chat #2 (no sessionId, should reuse main)"
chat2_raw="$TMP_DIR/chat2.sse"
curl "${CURL_OPTS[@]}" -N -X POST "$BASE_URL/api/chat" \
  -H "$auth_header" \
  -H "Content-Type: application/json" \
  -d '{"message":"继续，回复 ok"}' > "$chat2_raw"

done2_json="$(awk -F'data: ' '/"type":"done"/{print $2}' "$chat2_raw" | tail -n1)"
if [[ -z "$done2_json" ]]; then
  echo "[E2E][FAIL] chat #2 missing done event"
  cat "$chat2_raw"
  exit 1
fi
sid2="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.sessionId||''));" "$done2_json")"
if [[ -z "$sid2" ]]; then
  echo "[E2E][FAIL] chat #2 sessionId empty"
  cat "$chat2_raw"
  exit 1
fi

if [[ "$sid1" != "$sid2" ]]; then
  echo "[E2E][FAIL] session not merged: sid1=$sid1 sid2=$sid2"
  exit 1
fi

echo "[E2E][PASS] session merged sid=$sid2"
