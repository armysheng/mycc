# 每日合入 PR 回归报告（2026-03-03）

## 1. 回归范围（最近合入）

- PR #45 `feat(ops): migrate test users to free MCP search`
- PR #44 `fix(skills): avoid 'skill not found in directory' on install`
- PR #43 `fix(chat): auto-recover when session access is forbidden`

## 2. 用例设计来源（按要求基于文档/需求，不从代码反推）

- PR #45 设计文档：
  - `docs/process/mcp-search-migration.md`
- PR #44 需求描述（PR 说明）：
  - 安装/升级在多 catalog 候选目录下不再误报“技能不存在于目录中”
  - 缓存目录可见性以 root 视角判断
- PR #43 需求描述（PR 说明）：
  - 403 会话无权限时自动清理 sessionId，并自动重试一次

## 3. 新增回归用例

| 用例ID | 类型 | 覆盖点 | 位置 |
|---|---|---|---|
| RECENT-001 | E2E | 403 会话无权限自动恢复（清理 session + 重试一次） | `mycc-web-react/tests/e2e/recent/recent-merged.spec.ts` |
| RECENT-002 | E2E | 安装+升级接口不再返回“技能不存在于目录中” | `mycc-web-react/tests/e2e/recent/recent-merged.spec.ts` |
| SKILLS-RG-001 | Unit | installSkill 在“首个目录无目标/后续目录有目标”时安装成功 | `mycc-backend/src/skills/remote-skill-store.test.ts` |
| SKILLS-RG-002 | Unit | upgradeSkill 同场景升级成功 | `mycc-backend/src/skills/remote-skill-store.test.ts` |
| SKILLS-RG-003 | Unit | resolveCatalogDir 缓存在 root 可见/user 不可见时不误判失效 | `mycc-backend/src/skills/remote-skill-store.test.ts` |
| MCP-RG-001 | Script+Unit | migrate-mcp-search-config 脚本语法 + dry-run | `mycc-backend/src/scripts/mcp-search-migration.test.ts` |
| MCP-RG-002 | Script+Unit | migrate-mcp-server-duckduckgo 脚本语法 + dry-run | `mycc-backend/src/scripts/mcp-search-migration.test.ts` |
| FE-RG-001 | Unit | 403 会话恢复判定函数分支覆盖 | `mycc-web-react/src/components/chat/session-recovery.test.ts` |

## 4. 执行结果

### 4.1 后端

- `npm -C mycc-backend run build`：PASS
- `npm -C mycc-backend test -- --run`：PASS（`30/30`）

### 4.2 前端

- `npm -C mycc-web-react run build`：PASS
- `npm -C mycc-web-react run test:run`：PASS（`99/99`）

### 4.3 E2E（新增 recent 套件）

- `npm -C mycc-web-react run e2e:recent`：PASS（`2/2`）
  - RECENT-001：PASS
  - RECENT-002：PASS

## 5. 结果结论

- 本轮新增回归用例均已通过，未发现阻塞上线问题。
- PR #43/#44/#45 的主风险路径已被自动化覆盖（E2E + Unit + Script 验证）。

## 6. 证据路径

- E2E 测试产物：`output/playwright/test-results/`
- 后端新增测试：
  - `mycc-backend/src/skills/remote-skill-store.test.ts`
  - `mycc-backend/src/scripts/mcp-search-migration.test.ts`
- 前端新增测试：
  - `mycc-web-react/src/components/chat/session-recovery.test.ts`
  - `mycc-web-react/tests/e2e/recent/recent-merged.spec.ts`
