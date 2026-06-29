#!/bin/bash
# API 测试脚本

BASE_URL="${BASE_URL:-http://localhost:8080}"
MYCC_TEST_PHONE="${MYCC_TEST_PHONE:-}"
MYCC_TEST_PASSWORD="${MYCC_TEST_PASSWORD:-}"
MYCC_TEST_NICKNAME="${MYCC_TEST_NICKNAME:-测试用户}"
TOKEN=""

echo "=== 道友 AI Backend API 测试 ==="
echo ""

if [[ -z "$MYCC_TEST_PHONE" || -z "$MYCC_TEST_PASSWORD" ]]; then
  echo "ERROR: Missing MYCC_TEST_PHONE or MYCC_TEST_PASSWORD." >&2
  echo "Provide disposable local test credentials via env/private channel before running this script." >&2
  exit 1
fi

# 1. 健康检查
echo "1️⃣ 健康检查"
curl -s "$BASE_URL/health" | jq .
echo ""

# 2. 注册用户
echo "2️⃣ 注册用户"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg phone "$MYCC_TEST_PHONE" \
    --arg password "$MYCC_TEST_PASSWORD" \
    --arg nickname "$MYCC_TEST_NICKNAME" \
    '{phone: $phone, password: $password, nickname: $nickname}')")

echo "$REGISTER_RESPONSE" | jq .

# 提取 token
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.token')
echo "Token: $TOKEN"
echo ""

# 3. 获取当前用户信息
echo "3️⃣ 获取当前用户信息"
curl -s "$BASE_URL/api/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 4. 获取订阅信息
echo "4️⃣ 获取订阅信息"
curl -s "$BASE_URL/api/billing/subscription" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 4.1 获取套餐列表
echo "4️⃣-1 获取套餐列表"
curl -s "$BASE_URL/api/billing/plans" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 5. 发送消息（SSE 流式响应）
echo "5️⃣ 发送消息（前 10 行）"
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，请用一句话介绍你自己"
  }' | head -10
echo ""
echo "..."
echo ""

# 6. 获取会话列表
echo "6️⃣ 获取会话列表"
curl -s "$BASE_URL/api/chat/sessions?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 7. 获取使用统计
echo "7️⃣ 获取使用统计"
curl -s "$BASE_URL/api/billing/usage" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 8. 测试 Skills API
echo "8️⃣ 测试 Skills API"
curl -s "$BASE_URL/api/skills" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# 9. 测试 Automations API
echo "9️⃣ 测试 Automations API"
curl -s "$BASE_URL/api/automations" \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "✅ 测试完成！"
