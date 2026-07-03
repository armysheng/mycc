# Worktree 清理审计 2026-07-03

本文件记录 2026-07-03 对本机 MyCC worktree 与主工作区脏改的初步审计。审计原则：先分类，不直接删除不明来源产物。

## 总览

- 主工作区 `/Users/armysheng/workspace/mycc-main`：`146 M / 2 D / 62 ??`，不可直接发布。
- 当前 GitHub open PR：0。
- 生产仓库：`/home/armysheng/mycc`，当前已跟随 `origin/main`。
- 近期 landing PR `#126` - `#129` 均已合并。

## A 类：干净且已并入 main，可清理

以下 worktree 在审计时 `dirty=0` 且 HEAD 已并入 `origin/main`：

- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-frontend-static-permissions`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-login-registration-config-gate`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-public-copy-scrub`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-public-surface-smoke`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-registration-closed-inputs`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-deploy-unicode-guard`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-product-surface-audit`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-public-copy-audit`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-qoderwork-page`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-registration-gate`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-skill-copy-hardening`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-status-after-async`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/landing-visual-polish`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/public-test-credential-hygiene`
- `/Users/armysheng/workspace/mycc-auth-placeholders`
- `/Users/armysheng/workspace/mycc-codex-team-governance`
- `/Users/armysheng/workspace/mycc-landing-pr1`
- `/Users/armysheng/workspace/mycc-merge-all-main`
- `/Users/armysheng/workspace/mycc-pr126-review`
- `/Users/armysheng/workspace/mycc/.codex/worktrees/pr32-review`

建议动作：分批执行 `git worktree remove <path>`；如果本地分支仍存在且已并入 main，再删除本地分支。

## B 类：干净但未并入 main，待补 PR 或归档

以下 worktree 干净但仍显示未并入 `origin/main`：

- `codex/agent-sdk-env-public-error`
- `codex/auth-onboarding-closed-gate`
- `codex/cors-env-allowlist`
- `codex/deploy-node-guard-clean`
- `codex/landing-evidence-command`
- `codex/landing-status-docs`
- `codex/oauth-login`
- `codex/product-copy-cleanup`
- `codex/projects-compat-route`
- `codex/public-smoke-diagnostics`
- `codex/registration-closed-copy`
- `codex/landing-deploy-guard`
- `codex/landing-gate-env-isolation`
- `codex/landing-runbook-current-state`
- `codex/landing-runbook`
- `codex/landing-oauth-evidence`
- `codex/landing-skills-pr2`
- `codex/landing-runtime-pr3`
- `codex/landing-sandbox-pr4`
- `codex/landing-frontend-pr5`
- `codex/p1-auth-readiness-hotfix`
- `codex/p1-auth-readiness-hotfix-v2`

建议动作：逐个查 `gh pr list --state all --head <branch>`。如果 PR 已合并但 merge-base 仍不识别，记录原因后清理；如果没有 PR，决定是否还有业务价值。

## C 类：有未提交改动，冻结审计

以下 worktree 有未提交改动，不得删除：

- `/Users/armysheng/workspace/mycc-main`：`dirty=210`
- `/Users/armysheng/workspace/mycc-landing-integration`：`dirty=161`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-deploy-node-guard`：`dirty=5`
- `/Users/armysheng/.config/superpowers/worktrees/mycc-main/codex-login-surface-smoke`：`dirty=8`
- `/Users/armysheng/workspace/mycc`：`dirty=16`

建议动作：分别生成 `git diff --stat` 和 `git status --short`，按功能拆成候选 PR；无价值的改动经确认后再丢弃。

## 主工作区脏改分布

主要集中在：

- `mycc-backend/src`：运行时、E2B、harness、skills、auth、routes。
- `mycc-web-react/src`：landing、login、chat、skills、settings。
- `mycc-sandbox/templates`：E2B assistant sandbox。
- `docs/harness`、`mycc-backend/docs`：harness 与 landing readiness 文档。

## 下一步

1. 先提交本治理文档 PR。
2. 清理 A 类 worktree。
3. 对 C 类脏改生成详细 diff 台账。
4. 对 B 类未并入分支逐个判断：补 PR、归档或删除。
5. 让后续会话按 `AGENTS.md` 的交付格式汇报，避免再产生无主产物。
