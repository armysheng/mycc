# MyCC Landing Dirty Worktree Audit

Date: 2026-06-26

This audit classifies the current dirty worktree for landing release preparation. It is intentionally conservative: if a file is not clearly required by a PR boundary, do not stage it.

## Rules

- Do not stage the dirty worktree wholesale.
- Prefer clean release branches and precise hunk staging.
- Keep generated artifacts, screenshots, redesign experiments, and local output out of landing PRs.
- Keep public landing No-Go until staging `landing-live`, product audit, and rollback rehearsal pass.

## PR 1: Landing Gate / Harness / Release Checklist

Include these together because the verifier and docs depend on each other:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `scripts/dev-codex.sh`
- `evals/agent/**`
- `docs/harness/**`
- `mycc-backend/package.json`
- `mycc-backend/package-lock.json`
- `mycc-backend/scripts/harness-verify.ts`
- `mycc-backend/scripts/agent-eval-static.ts`
- `mycc-backend/scripts/apply-migrations.ts`
- `mycc-backend/scripts/landing-pr-classify.ts`
- `mycc-backend/scripts/verify-e2b-release-readiness.ts`
- `mycc-backend/src/harness/**`
- `mycc-backend/src/scripts/migration-sql.ts`
- `mycc-backend/src/scripts/apply-migrations.test.ts`
- `mycc-backend/src/scripts/staging-workflow.test.ts`
- `mycc-backend/docs/landing-readiness.md`
- `mycc-backend/docs/landing-pr-coordination.md`
- `mycc-backend/docs/landing-dirty-worktree-audit.md`
- `mycc-backend/docs/e2b-release-readiness.md`
- `mycc-backend/README.md`
- `mycc-backend/DEPLOYMENT.md`

Notes:

- `harness-verify.ts` imports `src/harness/telemetry.ts`.
- `agent-eval-static.ts` imports `src/harness/index.ts` and needs `evals/agent/**`.
- `verify-e2b-release-readiness.ts` checks `scripts/dev-codex.sh`, migration runner docs, landing readiness docs, and skill path policy.
- `landing-pr-classify.ts` is the machine guard for this audit; run it before staging files for a landing PR.
- The skill install path check must remain `~/.claude/skills/<assistantSkillName>`, not `~/.claude/skills/<skillId>`.

Do not include in PR 1:

- `mycc-backend/src/routes/harness.ts` and `mycc-backend/src/routes/harness.test.ts` unless a product run-trace UI/API is explicitly shipped in the same PR.
- Business runtime changes under `src/agent-runtime/**` beyond harness/eval support.
- Frontend UI changes.

## PR 2: Skills Product Path

Include:

- `docs/mycc-skill-center-integration.md`
- `mycc-backend/src/skills/**`
- `mycc-backend/src/routes/skills.ts`
- `mycc-web-react/src/api/skills.ts`
- `mycc-web-react/src/api/skills.test.ts`
- `mycc-web-react/src/components/SkillsPage.tsx`
- `mycc-web-react/src/components/SkillsPage.test.tsx`
- `mycc-web-react/src/components/ui/**` only when directly imported by `SkillsPage` or related modals.
- `mycc-web-react/tests/e2e/skills/**`

Must preserve:

- `skillId` is the market/API/statistics key.
- `assistantSkillName` is the Claude-visible skill name from `SKILL.md`.
- Runtime install/update writes to sandbox home `~/.claude/skills/<assistantSkillName>`.
- Registry browsing must work when runtime is unavailable; install/update still requires runtime.

Do not include:

- `mycc-sandbox/**` unless the change is the synced preload manifest for a specific skill release and the sandbox owner agrees.
- Runtime/session/trace changes.
- Workbench/product shell redesign.

## PR 3: Backend Runtime / Agent SDK / Trace / Readiness

Include:

- `mycc-backend/src/agent-runtime/**`
- `mycc-backend/src/ide/**` runtime/session/readiness/keepalive portions.
- `mycc-backend/src/startup/readiness.ts`
- `mycc-backend/src/startup/readiness.test.ts`
- `mycc-backend/src/routes/chat.ts` and `src/routes/chat*.test.ts` hunks only for Agent Runtime, E2B context, request id, abort, permission mode, images, session, and trace.
- `mycc-backend/src/routes/assistant.test.ts` only if it verifies runtime-facing behavior.
- `mycc-backend/db/migrations/007-add-agent-run-trace.sql`
- `mycc-backend/db/migrations/008-add-ide-session-identity.sql`
- `mycc-backend/db/schema.sql` related hunks.
- `mycc-backend/templates/e2b-code-server/agent-sdk-bridge.mjs`
- `mycc-backend/.env.example` runtime/readiness variables.

Must preserve:

- Landing default TTL is `3600`.
- Keepalive means renewing near-expiring sessions, not promising a 24-hour single E2B lease.
- Startup log says `工作间续租已启用`, not `工作间常驻续租已启用`.

Do not include:

- Skills installer/product hunks in `chat.ts`.
- Sandbox template implementation.
- `mycc-backend/src/routes/harness.ts` unless a run-trace product API is approved.
- Frontend UI.

## PR 4: Sandbox Template / Desktop / Browser

Include:

- `mycc-sandbox/**`
- `mycc-backend/templates/e2b-code-server/**` template-only compatibility changes.
- `mycc-backend/src/ide/e2b-template-contract.test.ts` template contract hunks.
- `mycc-backend/src/ide/e2b-agent-sdk-bridge-contract.test.ts` bridge contract hunks.
- `docs/mycc-assistant-sandbox-integration.md`
- `docs/plans/2026-05-29-e2b-codeserver-sandbox-poc.md`

Must preserve:

- Current path is a self-built assistant sandbox with Xvfb, XFCE, x11vnc, noVNC, websockify, Chromium, code-server, CCR, and Agent SDK bridge.
- It is not the official `@e2b/desktop` package.
- Desktop, browser, and code-server reuse the same sandbox via backend proxy.
- Browser clients receive only MyCC same-origin `openPath`; raw E2B host and traffic token remain server-side.
- `mycc-start-desktop` may prewarm `about:blank`; business navigation remains Claude/browser tool controlled.

## PR 5: Frontend Product / Workbench

Include only after product owner confirmation:

- `mycc-web-react/src/App.tsx`
- `mycc-web-react/src/App.test.tsx`
- `mycc-web-react/src/components/ChatPage.tsx`
- `mycc-web-react/src/components/ChatPage.workbench.test.tsx`
- `mycc-web-react/src/components/chat/AssistantWorkbenchDock.tsx`
- `mycc-web-react/src/components/chat/**` only for workbench/runtime status/product copy hunks.
- `mycc-web-react/src/components/assistant/AssistantHomePanel.tsx`
- `mycc-web-react/src/components/assistant/AssistantHomePanel.test.tsx`
- `mycc-web-react/src/components/layout/Sidebar.tsx`
- `mycc-web-react/src/components/layout/Sidebar.test.tsx`
- `mycc-web-react/src/config/api.ts`
- `mycc-web-react/src/config/api.test.ts`
- `mycc-web-react/src/utils/productCopy.ts`
- `mycc-web-react/src/utils/productCopy.test.ts`
- deletion of `mycc-web-react/src/utils/workbenchActivity.ts` and its test only if the selected product path removes the progress/activity panel.

Must preserve:

- User-facing UI should avoid provider terms such as `linuxUser`, E2B, sandbox, traffic token, raw noVNC URL, and code-server host.
- Right workbench should stay centered on `CC 的电脑` and `文件空间` unless a product owner explicitly reintroduces activity/progress panels.

## Do Not Stage By Default

Generated or experimental:

- `.codex-artifacts/**`
- `output/**`
- `home-design-sample.html`
- `design-qa.md`
- `mycc-web-react-redesign/**`

Needs owner review before any landing PR:

- `mycc-backend/src/auth/service.ts` production JWT and legacy VPS user creation changes.
- `mycc-backend/src/automations/**` model/cost and scheduler path changes.
- `mycc-backend/src/chat/openclaw-context.*` memory source wording.
- `mycc-backend/src/routes/onboarding.*`
- `mycc-backend/src/workspace/**`
- `mycc-backend/templates/user-workspace/**`
- `mycc-backend/src/routes/harness.*`
- `mycc-backend/src/sandbox/**`
- Broad frontend changes outside Skills and Workbench surfaces, including `AutomationsPage`, `HistoryView`, `Settings*`, and `WorkspacePage`, unless product owner assigns them to PR 5.

## Current Verification Evidence

- `npm run landing:classify -- --fail-on-unclassified`: passed after adding the classifier; unclassified count is 0.
- `npm run harness:verify -- --target=landing --no-write`: passed on 2026-06-26 08:40 Asia/Shanghai after adding the PR classifier guard.
  - Backend build passed.
  - Frontend build passed.
  - Backend tests passed: 59 files / 374 tests.
  - Frontend product tests passed: 8 files / 82 tests.
  - Static agent eval passed.
  - E2B release readiness passed.
  - E2B Agent doctor passed.
  - Sandbox template doctor passed.
- `npm run verify:e2b-release`: passed after the `assistantSkillName` path policy correction.
- Prior coordinator evidence: `npm run harness:verify -- --target=landing --no-write` passed with backend build, frontend build, backend tests, frontend product tests, static eval, E2B release readiness, E2B Agent doctor, and sandbox template doctor.
- Prior coordinator evidence: `npm --prefix mycc-sandbox test` passed with 14 tests.
- Prior coordinator evidence: `npm --prefix mycc-sandbox run doctor:template` passed.

## Current Decision

Go:

- Prepare clean release branches and split PRs using this audit.
- Start with PR 1, then PR 3, PR 4, PR 2, and finally PR 5 after product confirmation.

No-Go:

- Do not open public traffic.
- Do not promise 24-hour always-on E2B sandbox on the default landing path.
- Do not stage unrelated dirty files or generated artifacts.
