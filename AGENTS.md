# AGENTS.md

本仓库所有 Codex/Claude 子会话都必须遵守本文件。默认使用中文沟通，环境按 macOS 处理。

## Leader 发布原则

1. **禁止从脏工作区发布。** `/Users/armysheng/workspace/mycc-main` 可用于审计和协调，但不能直接作为发版来源。
2. **所有可上线改动必须走干净 worktree + 独立分支 + PR。** 分支使用 `codex/<scope>` 命名，PR 合并后再部署。
3. **一个 PR 只解决一个明确问题。** 不把 UI、后端、沙盒、文档和临时排障杂改混在一起。
4. **生产只跟随已合并的 `origin/main`。** 不从个人 worktree、未合并分支或本地脏改直接 `scp`/覆盖生产代码。
5. **上线前必须有新鲜验证证据。** 至少记录相关测试、build、lint 或 smoke 命令及结果；不能用“应该可以”代替验证。
6. **涉及生产密钥只输出存在性和长度。** 不打印 `.env`、OAuth secret、E2B key、CCR token、JWT secret 等真实值。
7. **清理优先级：已合并且干净的 worktree 可清；未合并或有脏改的只能审计、归档或转 PR，不能直接删除。**

## 多会话协作规则

1. 新会话开始前先看 `git status --short --branch` 和 `git worktree list`，确认自己所在分支和脏改范围。
2. 子会话/子 agent 必须说明自己的写入范围；不同会话不能同时改同一批文件。
3. 子会话完成后必须留下：分支名、PR 链接或未提交 diff 摘要、验证命令、是否需要清理 worktree。
4. Leader 负责合并、部署和清理台账；子会话不要自行把未审改动推生产。
5. 发现别人留下的脏改时，先归类和汇报，不要 reset、checkout 或删除。

## 当前发布门禁

生产验收至少覆盖：

- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface`
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy`
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-onboarding`
- E2B/Agent SDK 相关发布需补跑 `npm run doctor:e2b-agent` 和对应 live smoke。

详见 `docs/process/release-governance.md`。
