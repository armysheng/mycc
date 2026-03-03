# Session Soul（OpenClaw 对齐）QA 用例（评审版）

版本：v0.1  
范围分支：`codex/openclaw-session-soul-file-mode`

## 1. 目标与范围

目标：
1. 验证 `id + soul` 为文件化持久层（不新增数据库表）。
2. 验证 `MEMORY.md` 可读写且在聊天请求中注入上下文。

范围内 API：
1. `GET /api/chat/identity`
2. `GET /api/chat/memory`
3. `PUT /api/chat/memory`
4. `POST /api/chat`（记忆注入验证）

## 2. 门禁映射

1. PR：`SMOKE`
2. main：`SMOKE + CORE`
3. nightly：`SMOKE + CORE + NIGHTLY`

## 3. 前置条件

1. 后端环境变量：
   - `CHAT_SOUL_DIR` 可写（可为空使用默认目录）
2. 可登录测试账号（建议新注册账号，避免历史数据干扰）。
3. Chat 链路可用（若执行记忆注入用例）。

## 4. 用例清单

### 4.1 SMOKE（PR 阻断）

SMOKE-001 identity 可读
1. 步骤：登录后调用 `GET /api/chat/identity`。
2. 断言：200 + `success=true` + 返回 `identityId/soulId`。

SMOKE-002 memory 可写可读
1. 步骤：`PUT /api/chat/memory` 写入内容，再 `GET /api/chat/memory`。
2. 断言：读回内容一致，`chars>0`。

SMOKE-003 memory 注入聊天上下文
1. 步骤：
   - `PUT /api/chat/memory` 写入“先结论后细节”；
   - 发起 `POST /api/chat`，提一个需要输出结构的请求。
2. 断言：响应行为体现记忆偏好（先结论后细节），且接口成功。

### 4.2 CORE（main 阻断）

CORE-001 多用户隔离
1. 步骤：A/B 两个账号分别调用 `GET /api/chat/identity` 和 `PUT/GET /api/chat/memory`。
2. 断言：A/B 的 `identityId/soulId` 不同，memory 互不可见。

CORE-002 空 memory 清理
1. 步骤：`PUT /api/chat/memory` 提交空字符串。
2. 断言：`GET /api/chat/memory` 返回空内容，`chars=0`，服务不报错。

### 4.3 NIGHTLY（稳态）

NIGHTLY-001 重启后持久化
1. 步骤：写入 memory 后重启服务，再次读取 identity/memory。
2. 断言：`soulId` 不变，memory 内容不丢失。

NIGHTLY-002 高频读写稳定性
1. 步骤：连续 50 次 `PUT/GET /api/chat/memory` + 20 次 `GET /api/chat/identity`。
2. 断言：成功率 100%，无 5xx，响应时间无明显退化。

## 5. 可执行脚本（建议）

后端提供了本地 e2e 脚本：

```bash
cd /Users/armysheng/.codex/worktrees/445c/mycc/mycc-backend
./scripts/e2e-session-soul.sh
```

## 6. 证据要求

1. API 证据：每条 SMOKE/CORE 的请求与响应摘要。
2. 日志证据：至少一条 memory 写入与读取日志/响应记录。
3. 文件证据：`CHAT_SOUL_DIR/user-<id>/profile.json`、`MEMORY.md` 脱敏片段。
