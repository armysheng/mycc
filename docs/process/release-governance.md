# 道友 AI 发布与清理治理

更新时间：2026-07-03

## 目标

让所有会话围绕同一套发布原则工作：干净分支、可验证、可回滚、可清理。Leader 负责统筹，子会话负责边界清晰的任务交付。

## 发布主线

1. 从 `origin/main` 创建干净 worktree。
2. 在 `codex/<scope>` 分支上完成一个明确改动。
3. 跑对应测试并记录验证证据。
4. 创建 PR，等 CI 通过。
5. 合并 PR。
6. 生产仓库 `git pull --ff-only origin main`。
7. 跑生产 smoke。
8. 清理该 PR 的临时 worktree、本地分支和远端 head 分支。

## 禁止事项

- 禁止从 `/Users/armysheng/workspace/mycc-main` 这种脏工作区直接发布。
- 禁止把别的会话的脏改顺手打包进自己的 PR。
- 禁止对不明来源改动执行 `git reset --hard`、`git checkout -- <file>` 或删除目录。
- 禁止把真实密钥、token、OAuth secret 打印到聊天、日志或 PR。
- 禁止用未合并分支直接覆盖生产代码。

## Worktree 清理分级

| 等级 | 条件 | 动作 |
| --- | --- | --- |
| A 可清 | worktree 干净，HEAD 已并入 `origin/main` | `git worktree remove <path>`，再删除本地残留分支 |
| B 待审 | worktree 干净，但 HEAD 未并入 `origin/main` | 看是否已有 PR；无 PR 则决定补 PR 或归档 |
| C 冻结 | worktree 有未提交改动 | 生成 diff 摘要，Owner 确认后再拆 PR 或丢弃 |
| D 生产证据 | `.env.bak-*`、smoke 备份、部署证据 | 保留到下一次稳定发布后，再按时间窗口归档/删除 |

## 子会话交付格式

子会话结束必须回复：

```text
分支：
PR：
写入范围：
验证：
遗留：
建议清理：
```

如果没有 PR，必须说明为什么没有 PR，以及改动在哪里。

## 生产验收门

通用 landing/auth 发布：

```bash
BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface
BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy
BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-onboarding
```

涉及 E2B/Agent SDK/IDE：

```bash
npm run doctor:e2b-agent
npm run smoke:e2b-agent-sdk-workspace
```

涉及前端：

```bash
npm run typecheck
npm run lint
npm run build
```

涉及后端：

```bash
npm run build
npx vitest run <相关测试文件>
```

## Leader 职责

- 维护 worktree/分支/PR 台账。
- 决定哪些改动进入 release train。
- 合并前确认 CI 和必要 smoke。
- 部署后确认生产 commit、服务状态和 smoke。
- 定期清理 A 类 worktree；B/C 类必须先审计。

## 当前口径

- 产品名：道友 AI。
- 公司口径：念头通达。
- 生产域名：`https://daoyou.iaigc.fun`。
- 生产只从 `origin/main` 快进更新。
