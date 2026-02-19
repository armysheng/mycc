#!/usr/bin/env bash
set -euo pipefail

API_URL="http://localhost:8080"
WEB_URL="http://localhost:3000"
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
  --web-url <url>        前端地址，默认: http://localhost:3000
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

echo "[INFO] 1/5 检查服务健康状态"
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

echo "[INFO] 2/5 登录获取 token"
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

echo "[INFO] 3/5 鉴权接口 /api/auth/me"
ME_RESP_FILE="$TMP_DIR/me.json"
ME_CODE=$(curl -s -o "$ME_RESP_FILE" -w '%{http_code}' "$API_URL/api/auth/me" \
  -H "Authorization: Bearer $TOKEN")
if [[ "$ME_CODE" != "200" ]]; then
  echo "[FAIL] /api/auth/me 返回 $ME_CODE"
  cat "$ME_RESP_FILE"
  exit 4
fi
echo "[PASS] /api/auth/me 返回 200"

echo "[INFO] 4/5 发送聊天请求（SSE）"
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

echo "[INFO] 5/5 结果摘要"
FIRST_EVENTS=$(printf '%s' "$CHAT_RESP" | sed -n '1,8p')
echo "------ SSE 前几行 ------"
echo "$FIRST_EVENTS"
echo "-----------------------"

echo "[DONE] 回归接口验证通过"
