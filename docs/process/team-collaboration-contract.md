# MyCC 团队协作契约（Team Leader 版）

适用角色：`human`（产品决策）、`codex`（team leader）、`claude`（实现）、`andy`（实现）、`mycc_test`（测试）。

## 1. 角色分工

- `human`：定义业务优先级、取舍与最终放行。
- `codex`：任务拆分、接口契约、冲突消解、合并顺序、质量门禁。
- `claude`：按任务实现功能，提交 PR，响应 review。
- `andy`：按任务实现功能，提交 PR，响应 review。
- `mycc_test`：执行回归与验收，输出缺陷报告与复现证据。

## 2. 单一事实源（Single Source of Truth）

- 任务状态：`agent-kanban/boards/mycc/board.yaml`
- 设计与计划：`docs/plans/*`
- 回归与验收：`docs/testing/regression-smoke.md`
- 团队运行细则：`docs/process/team-operating-model.md`
- 新成员入场：`docs/process/new-member-onboarding.md`
- 交接模板：`docs/process/handoff-template.md`

规则：口头结论不算完成，必须同步到看板或文档。

## 3. 分支与 PR 规则

- 一个任务对应一个分支、一个 PR、一个 owner。
- 禁止跨 PR 混改同类需求。
- PR 描述必须包含：
  - 变更范围（文件列表）
  - 风险点
  - 回归点
  - 回滚方式

## 4. 文件所有权与冲突处理

- 任务 owner 对目标文件有写优先权。
- 他人修改同文件前，必须在看板创建协作子任务并通知 owner。
- 冲突由 `codex` 裁决：
  - 保留哪条实现
  - 回退哪些重复改动
  - 需要拆成几条 PR

## 5. 交接协议（每日强制）

每位执行者下线前必须提交“交接四件套”：

1. 当前分支与 commit SHA
2. 已完成项 / 未完成项
3. 风险与阻塞
4. 明日第一步

未交接视为任务不可接管。

## 6. 质量门禁（Merge Gate）

合并必须同时满足：

1. CI 全绿
2. 回归清单通过
3. 无未决 P0/P1
4. `codex` 完成冲突与重复改动审查

任一不满足，不允许合并。

## 7. 决策权限

- 实现细节：`claude` / `andy` / `codex` 可自主决策。
- 架构、接口、合并策略：`codex` 决策。
- 产品范围与优先级：`human` 决策。

## 8. 例外机制

- 紧急修复可先合入，但必须在 24 小时内补：
  - 看板记录
  - 变更说明
  - 回归结果
- 发现重复开发必须立即停工，由 `codex` 出具保留/回退方案。
