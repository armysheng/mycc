# Gemini Frontend Collaboration Brief

Date: 2026-05-31
Owner: MyCC product/frontend
Use this document as the handoff prompt when asking Gemini to review or design MyCC frontend work.

## Product Positioning

MyCC is an out-of-the-box personal assistant.

The product should feel like:

- A helpful assistant that can remember context and keep working.
- A place to start tasks, continue work, review outputs, and take over only when needed.
- A product experience first, with advanced coding/workbench capability behind the scenes.

The product should not feel like:

- An IDE homepage.
- A provider/runtime dashboard.
- A sandbox/debug console.
- A raw Claude Code UI clone.

## User-Facing Language Rules

Avoid exposing implementation terms in ordinary UI copy:

- E2B
- CCR
- Agent SDK
- code-server
- GNU
- Remote IDE
- sandbox / 沙盒
- Claude Code
- base url
- token
- session
- port
- proxy

Preferred product words:

- 助理
- 任务
- 继续
- 等你确认
- 交付物 / 制品
- 记忆
- 工作区
- 工作间
- 打开代码编辑器
- 查看文件
- 预览结果

Advanced/debug screens may mention technical details only when the user intentionally opens diagnostics.

## Current Frontend Direction

The first screen should be assistant-first:

1. A simple input asking what the assistant should help with today.
2. Recent or continuing work, without pretending unfinished conversations have durable task status.
3. Recent deliverables, files, previews, reports, PRs, or logs when available.
4. Memory cards that explain what the assistant knows and which sources are editable.
5. A quiet advanced workbench entry for file/code takeover.

Avoid making the first screen a file explorer, IDE, runtime health panel, or technical checklist.

## Current Known Local Change

The current MyCC branch is removing repo/debug wording from the home entry:

- `MyCC Personal Assistant` becomes `MyCC 个人助理`.
- The default new-chat headline no longer falls back to `mycc-main`.
- Tests assert that the new user home does not show `mycc-main`.

This change is intentionally small and should be reviewed as a product-copy cleanup, not a full redesign.

## High-Priority UI Review Questions

When reviewing MyCC UI, answer these first:

1. Does the screen make it obvious that MyCC is a personal assistant?
2. Does any visible copy leak implementation details that should be hidden?
3. Is there one clear next action for a new user?
4. Are recent conversations, deliverables, memory, and workbench separated clearly?
5. Does the advanced workbench feel like an optional takeover area rather than the main product?

## Suggested Gemini Prompt

Copy this prompt into Gemini when asking for UI review:

```text
你是 MyCC 的前端产品体验 reviewer。请只做产品/UI/交互 review，除非我明确要求你改代码。

项目定位：
MyCC 是开箱即用的个人助理，不是 IDE、运行时 dashboard、沙盒控制台或 Claude Code UI clone。

用户偏好：
普通 UI 不要暴露这些底层词：E2B、CCR、Agent SDK、code-server、GNU、Remote IDE、sandbox/沙盒、Claude Code、base url、token、session、port、proxy。

请从这几个角度评审：
1. 是否符合“个人助理产品入口”？
2. 是否有技术词或调试状态喧宾夺主？
3. 新用户第一步是否足够清晰？
4. 最近会话、制品/交付物、记忆、工作间的层级是否清楚？
5. 如果要改，最多给 3 个 P0/P1 建议，并说明为什么。

输出格式：
- 结论：可以提交 / 需要先修
- 风险：最多 3 条
- 建议：最多 3 条，按优先级排序
- 如果涉及代码，请指出文件路径和最小修改范围
```

## Suggested Gemini Design Prompt

Copy this prompt when asking Gemini for a redesign proposal:

```text
请为 MyCC 设计一个“个人助理首页”的 UI/交互方案，不要写成技术 dashboard。

核心模块：
1. 顶部：一句自然的助理问候和一个极简输入框。
2. 继续工作：最近会话或待继续任务，但不要声明完成/失败等没有持久数据支撑的状态。
3. 最近制品：报告、文件、预览、PR、日志等可复用产出。
4. 助理记忆：个人偏好、项目背景、长期记忆，区分可编辑和只读。
5. 高级工作间：文件、代码编辑器、预览入口，只作为接管入口。

设计要求：
- 中文为主，温暖、清晰、轻量。
- 不出现底层技术词。
- 页面第一焦点是“今天要助理帮我做什么”。
- 给出桌面和移动端布局建议。
- 给出空态文案。
- 最后列出可落地的组件拆分。
```

## Delivery Expectations

For review-only tasks, Gemini should return:

- A short verdict.
- Specific issues with user impact.
- Minimal changes required before submit.

For implementation tasks, Gemini should return:

- A small patch plan.
- Files to touch.
- Tests to update.
- Verification commands.

Prefer small shippable changes over broad redesigns.

## Related Docs

- `docs/superpowers/specs/2026-05-30-mycc-personal-assistant-product-model.md`
- `docs/superpowers/specs/2026-05-30-mycc-workbench-v0-design.md`
- `docs/plans/2026-02-20-frontend-ui-product-rectify-v1.md`
