#!/usr/bin/env bash
set -euo pipefail

API_URL="http://localhost:8080"
WEB_URL="http://localhost:3001"
CREDENTIAL=""
PASSWORD=""
TIMEOUT_SECONDS=45
MESSAGE="回归验证：请回复ok"

usage() {
  cat <<USAGE
用法:
  run_regression.sh --credential <手机号或邮箱> --password <密码> [选项]

选项:
  --api-url <url>        后端地址，默认: http://localhost:8080
  --web-url <url>        前端地址，默认: http://localhost:3001
  --timeout <秒>         /api/chat 超时秒数，默认: 45
  --message <内容>       回归测试消息内容
  -h, --help             查看帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="$2"; shift 2 ;;
    --web-url)
      WEB_URL="$2"; shift 2 ;;
    --credential)
      CREDENTIAL="$2"; shift 2 ;;
    --password)
      PASSWORD="$2"; shift 2 ;;
    --timeout)
      TIMEOUT_SECONDS="$2"; shift 2 ;;
    --message)
      MESSAGE="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      usage
      exit 1 ;;
  esac
done

if [[ -z "$CREDENTIAL" || -z "$PASSWORD" ]]; then
  echo "[ERROR] --credential 和 --password 必填" >&2
  usage
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] 缺少命令: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd node

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[INFO] 1/8 检查服务健康状态"
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL") || WEB_CODE="000"
API_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/health") || API_CODE="000"

if [[ "$WEB_CODE" != "200" ]]; then
  echo "[FAIL] 前端不可用: $WEB_URL -> $WEB_CODE"
  exit 2
fi
if [[ "$API_CODE" != "200" ]]; then
  echo "[FAIL] 后端不可用: $API_URL/health -> $API_CODE"
  exit 2
fi
echo "[PASS] 前后端健康检查通过"

echo "[INFO] 2/8 登录获取 token"
LOGIN_PAYLOAD=$(printf '{"credential":"%s","password":"%s"}' "$CREDENTIAL" "$PASSWORD")
LOGIN_RESP=$(curl -sS -X POST "$API_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")

TOKEN=$(printf '%s' "$LOGIN_RESP" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
try {
  const d = JSON.parse(raw);
  process.stdout.write((d?.data?.token || ""));
} catch { process.stdout.write(""); }
')

if [[ -z "$TOKEN" ]]; then
  ERR=$(printf '%s' "$LOGIN_RESP" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
try {
  const d = JSON.parse(raw);
  process.stdout.write(d?.error || raw);
} catch { process.stdout.write(raw); }
')
  echo "[FAIL] 登录失败: $ERR"
  exit 3
fi
echo "[PASS] 登录成功"

echo "[INFO] 3/8 鉴权接口 /api/auth/me"
ME_RESP_FILE="$TMP_DIR/me.json"
ME_CODE=$(curl -s -o "$ME_RESP_FILE" -w '%{http_code}' "$API_URL/api/auth/me" \
  -H "Authorization: Bearer $TOKEN")
if [[ "$ME_CODE" != "200" ]]; then
  echo "[FAIL] /api/auth/me 返回 $ME_CODE"
  cat "$ME_RESP_FILE"
  exit 4
fi
echo "[PASS] /api/auth/me 返回 200"

echo "[INFO] 4/8 发送聊天请求（SSE）"
CHAT_PAYLOAD=$(printf '{"message":"%s"}' "$MESSAGE")
CHAT_RESP=$(curl -sS -N --max-time "$TIMEOUT_SECONDS" -X POST "$API_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$CHAT_PAYLOAD")

if [[ "$CHAT_RESP" == *'"error":"额度已用完"'* ]]; then
  echo "[FAIL] 聊天失败：额度已用完"
  echo "$CHAT_RESP" | sed -n '1,20p'
  exit 5
fi

if [[ "$CHAT_RESP" == *'"type":"error"'* ]]; then
  echo "[FAIL] 聊天流返回 error 事件"
  echo "$CHAT_RESP" | sed -n '1,30p'
  exit 5
fi

if [[ "$CHAT_RESP" != *'data: '* ]]; then
  echo "[FAIL] 聊天返回不是 SSE 数据流"
  echo "$CHAT_RESP" | sed -n '1,20p'
  exit 5
fi

echo "[PASS] 聊天流已返回 SSE 数据"

echo "[INFO] 5/8 获取会话列表 /api/chat/sessions"
SESS_RESP_FILE="$TMP_DIR/sessions.json"
SESS_CODE=$(curl -s -o "$SESS_RESP_FILE" -w '%{http_code}' \
  "$API_URL/api/chat/sessions?limit=1&offset=0" \
  -H "Authorization: Bearer $TOKEN")
if [[ "$SESS_CODE" != "200" ]]; then
  echo "[FAIL] /api/chat/sessions 返回 $SESS_CODE"
  cat "$SESS_RESP_FILE"
  exit 6
fi

SESSION_ID=$(cat "$SESS_RESP_FILE" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
try {
  const d = JSON.parse(raw);
  const id = d?.data?.conversations?.[0]?.sessionId || "";
  process.stdout.write(id);
} catch { process.stdout.write(""); }
')
if [[ -z "$SESSION_ID" ]]; then
  echo "[FAIL] 会话列表为空，未找到可验证的 sessionId"
  cat "$SESS_RESP_FILE"
  exit 6
fi
echo "[PASS] 会话列表可用，sessionId=$SESSION_ID"

echo "[INFO] 6/8 获取会话历史 /api/chat/sessions/:id/messages"
MSG_RESP_FILE="$TMP_DIR/messages.json"
MSG_CODE=$(curl -s -o "$MSG_RESP_FILE" -w '%{http_code}' \
  "$API_URL/api/chat/sessions/$SESSION_ID/messages?limit=20" \
  -H "Authorization: Bearer $TOKEN")
if [[ "$MSG_CODE" != "200" ]]; then
  echo "[FAIL] /messages 返回 $MSG_CODE"
  cat "$MSG_RESP_FILE"
  exit 7
fi
MSG_TOTAL=$(cat "$MSG_RESP_FILE" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
try {
  const d = JSON.parse(raw);
  const total = Number(d?.data?.total || 0);
  process.stdout.write(String(total));
} catch { process.stdout.write("0"); }
')
if [[ "${MSG_TOTAL:-0}" -lt 1 ]]; then
  echo "[FAIL] /messages 返回为空，total=$MSG_TOTAL"
  cat "$MSG_RESP_FILE"
  exit 7
fi
echo "[PASS] 会话历史可加载，messages total=$MSG_TOTAL"

echo "[INFO] 7/8 重命名会话 /api/chat/sessions/:id/rename"
RENAME_TITLE="regression-$(date +%s)"
RENAME_PAYLOAD=$(printf '{"newTitle":"%s"}' "$RENAME_TITLE")
RENAME_RESP_FILE="$TMP_DIR/rename.json"
RENAME_CODE=$(curl -s -o "$RENAME_RESP_FILE" -w '%{http_code}' -X POST \
  "$API_URL/api/chat/sessions/$SESSION_ID/rename" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$RENAME_PAYLOAD")
if [[ "$RENAME_CODE" != "200" ]]; then
  echo "[FAIL] /rename 返回 $RENAME_CODE"
  cat "$RENAME_RESP_FILE"
  exit 8
fi
echo "[PASS] 会话重命名成功：$RENAME_TITLE"

echo "[INFO] 8/8 工具箱接口 /api/skills + /api/automations"
SKILLS_CODE=$(curl -s -o "$TMP_DIR/skills.json" -w '%{http_code}' \
  "$API_URL/api/skills" \
  -H "Authorization: Bearer $TOKEN")
AUTOS_CODE=$(curl -s -o "$TMP_DIR/autos.json" -w '%{http_code}' \
  "$API_URL/api/automations" \
  -H "Authorization: Bearer $TOKEN")
if [[ "$SKILLS_CODE" != "200" || "$AUTOS_CODE" != "200" ]]; then
  echo "[FAIL] 工具箱接口失败: skills=$SKILLS_CODE automations=$AUTOS_CODE"
  echo "--- /api/skills ---"
  cat "$TMP_DIR/skills.json"
  echo "--- /api/automations ---"
  cat "$TMP_DIR/autos.json"
  exit 9
fi
echo "[PASS] 工具箱接口可用"

echo "[INFO] 结果摘要"
FIRST_EVENTS=$(printf '%s' "$CHAT_RESP" | sed -n '1,8p')
echo "------ SSE 前几行 ------"
echo "$FIRST_EVENTS"
echo "-----------------------"

echo "[DONE] 回归接口验证通过（含历史加载、重命名、工具箱）"
