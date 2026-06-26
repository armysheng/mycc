# MyCC Landing PR Coordination

This document tracks the current landing release split. It is a coordination artifact, not a product spec.

For file-level dirty worktree classification, use `mycc-backend/docs/landing-dirty-worktree-audit.md`.
For concrete PR submission commands, use `mycc-backend/docs/landing-pr-submit-checklist.md`.

## Release Threads

| Line | Owner thread | Status | Release role |
| --- | --- | --- | --- |
| Landing Gate / Release Coordinator | current thread | In progress | Owns `landing`, `landing-live`, ship/no-ship, staging and rollback checklist. |
| Skills Product | `优化 mycc 技能中心` | Ready for PR split | Owns skills registry/service/routes, SkillsPage, Claude skill name/path behavior. |
| Backend Runtime | `更新代码并调研架构优化` | Ready for PR split | Owns Agent SDK runtime, E2B session reuse, trace, readiness, keepalive policy. |
| Sandbox / Desktop | `设计 E2B 桌面能力` | Ready for PR split | Owns assistant sandbox template, desktop/noVNC/browser helpers, template contract. |
| Frontend Product / Workbench | PR 5 sub-agent `Hume` + current thread | Ready for PR split | Owns product copy cleanup and the normal workbench surface: assistant browser plus project files. |

## Proposed PR Split

### PR 1: Landing Gate and Release Checklist

Include:

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
- `mycc-backend/docs/landing-readiness.md`
- `mycc-backend/docs/landing-pr-coordination.md`
- `mycc-backend/docs/landing-dirty-worktree-audit.md`
- `mycc-backend/docs/e2b-release-readiness.md`
- `mycc-backend/README.md`
- `mycc-backend/DEPLOYMENT.md`
- `mycc-backend/src/harness/**`
- `mycc-backend/src/scripts/migration-sql.ts`
- `mycc-backend/src/scripts/apply-migrations.test.ts`
- `mycc-backend/src/scripts/staging-workflow.test.ts`

Purpose:

- Define non-live `landing` gate.
- Define live `landing-live` gate.
- Document staging, rollback, and Go/No-Go criteria.
- Keep E2B landing TTL at `3600` seconds unless the target plan explicitly supports longer leases.
- Keep CI/staging migration/readiness checks aligned with the landing gate.
- Provide `npm run landing:classify` as a machine-readable guard before hunk staging.

Must exclude:

- `mycc-backend/src/routes/harness.ts` unless the product workbench explicitly exposes run trace history in the same PR.
- Runtime implementation hunks beyond the thin harness telemetry/eval helpers listed above.
- Frontend product UI.

### PR 2: Skills Product Path

Include:

- `mycc-backend/src/skills/**`
- `mycc-backend/src/routes/skills.ts`
- `mycc-web-react/src/api/skills.ts`
- `mycc-web-react/src/components/SkillsPage.tsx`
- `mycc-web-react/src/components/SkillsPage.test.tsx`
- `mycc-web-react/tests/e2e/skills/**`
- Optional shared UI helpers under `mycc-web-react/src/components/ui/**` when directly used by `SkillsPage`.
- Optional `docs/mycc-skill-center-integration.md`.

Must preserve:

- Market `skillId` stays the API/statistics identifier.
- `assistantSkillName` is the Claude-visible skill name from `SKILL.md`.
- Runtime install paths use `~/.claude/skills/<assistantSkillName>`.
- Users can browse registry skills when the runtime is unavailable; install/update still requires the runtime.

Verified by the skills thread:

- Backend skills/service/routes tests passed.
- Frontend SkillsPage/API tests passed.
- Skills Playwright e2e passed.
- Backend and frontend builds passed.
- Release coordinator fixed `docs/mycc-skill-center-integration.md` and `verify-e2b-release-readiness.ts` so the release gate now enforces `~/.claude/skills/<assistantSkillName>` rather than the stale `~/.claude/skills/<skillId>` path.

### PR 3: Backend Runtime and Readiness

Candidate include list:

- `mycc-backend/src/agent-runtime/**`
- `mycc-backend/src/ide/**` runtime/session/readiness/keepalive portions
- `mycc-backend/src/startup/readiness.*`
- `mycc-backend/src/routes/chat*` only for Agent Runtime, E2B context, request/trace, permission mode, and abort behavior
- `mycc-backend/db/migrations/007-add-agent-run-trace.sql`
- `mycc-backend/db/migrations/008-add-ide-session-identity.sql`
- `mycc-backend/db/schema.sql` related changes
- Required thin telemetry helper if run trace depends on it
- `mycc-backend/templates/e2b-code-server/agent-sdk-bridge.mjs`
- Runtime readiness config/docs/scripts such as `.env.example`, `package.json`, `scripts/smoke-e2b-agent-workspace.ts`, and `docs/e2b-release-readiness.md` when they are not already included in PR 1

Must exclude:

- Skills installer/product hunks from `chat.ts`
- Sandbox template implementation
- Frontend product UI
- Harness API routes unless explicitly needed by release coordinator

Current evidence:

- Runtime thread reports 27 backend test files / 195 tests passing.
- Runtime thread reports backend build passing.
- Release coordinator reran `verify:e2b-release` successfully.
- Runtime thread identified the correct landing policy: default TTL is clamped to 3600 seconds; keepalive renews near-expiring sessions but does not promise a 24-hour single lease.
- Release coordinator corrected the startup log wording from "工作间常驻续租已启用" to "工作间续租已启用" so product and ops copy no longer imply a 24-hour always-on lease.
- Runtime owner final report received and matches the coordinator boundary above.

### PR 4: Sandbox Template and Desktop

Candidate include list:

- `mycc-sandbox/**`
- `mycc-backend/templates/e2b-code-server/**` template-only changes
- `mycc-backend/src/ide/e2b-template-contract.test.ts` template contract hunks
- `mycc-backend/src/ide/e2b-agent-sdk-bridge-contract.test.ts` bridge contract hunks
- `docs/mycc-assistant-sandbox-integration.md`
- `docs/plans/2026-05-29-e2b-codeserver-sandbox-poc.md` only after aligning stale template references

Must preserve:

- Current implementation is self-built Xvfb + xfce + x11vnc + noVNC + Chromium, not the official `@e2b/desktop` package.
- Desktop starts from the same E2B sandbox session via backend proxy.
- Browser clients never receive raw E2B host or traffic token.
- User-level Claude config and skills live under the sandbox home `~/.claude`.

Current evidence:

- Release coordinator reran `npm --prefix mycc-sandbox test`: 14 tests passed.
- Release coordinator reran `npm --prefix mycc-sandbox run doctor:template`: passed, including remote template existence.
- Desktop thread reports `allowPublicTraffic:false` in E2B smoke scripts.
- Desktop thread reports public API responses expose only `openPath`; backend injects traffic token server-side.
- Desktop thread found stale documentation claiming the old template path and a mismatch around whether the template opens an initial `about:blank` Chromium window.
- Release coordinator corrected the two stale documentation points:
  - Current main template is `mycc-sandbox/templates/e2b-assistant-sandbox`; old `mycc-backend/templates/e2b-code-server` is transitional.
  - `mycc-start-desktop` may prewarm an `about:blank` Chromium window, while business navigation still belongs to Claude/browser tools.

### PR 5: Frontend Product / Workbench

Include:

- Workbench surface changes under `mycc-web-react/src/components/ChatPage.tsx`
- `mycc-web-react/src/components/chat/AssistantWorkbenchDock.tsx`
- related tests and product copy helpers
- deletion of right-side `workbenchActivity` if included in the chosen product path

Must exclude by default:

- `mycc-web-react-redesign/**`
- `.codex-artifacts/**`
- `output/**`
- one-off screenshots or local design samples

Current evidence:

- Frontend owner split PR 5 into `/Users/armysheng/workspace/mycc-landing-pr5` on `codex/landing-frontend-pr5`.
- PR 5 no longer includes the foreground run trace / harness activity surface; the workbench product path is assistant browser plus project files.
- Release coordinator reran focused PR 5 frontend tests: 6 files / 44 tests passed.
- PR 5 sub-agent reran product/workbench focused tests, frontend build, `git diff --check`, and chat-flow Playwright e2e; all passed.
- Release coordinator reran PR 5 frontend build; passed.
- PR 5 `output/` Playwright artifacts were removed after e2e.

## Default Exclusions

Do not include these in landing PRs unless explicitly promoted:

- `mycc-web-react-redesign/**`
- `.codex-artifacts/**`
- `output/**`
- `home-design-sample.html`
- `design-qa.md`
- ad hoc screenshots
- Anything listed under "Do Not Stage By Default" in `mycc-backend/docs/landing-dirty-worktree-audit.md`.

## Landing Blockers

- Local `landing-live` cannot be considered authoritative without a running target backend and E2B-capable staging environment.
- Staging still needs `db:migrate`, `/readyz/deep`, `landing-live`, product surface audit, and rollback rehearsal.

## Current Gate Evidence

- `npm run landing:classify -- --fail-on-unclassified`: passed, current dirty files classify into PR1-5, `needs-owner-review`, or `do-not-stage`; unclassified count is 0.
- `npm run harness:verify -- --target=landing --no-write`: passed on 2026-06-26 08:40 Asia/Shanghai after adding the PR classifier guard.
  - Backend build: passed.
  - Frontend build: passed.
  - Backend tests: passed, 59 files / 374 tests.
  - Frontend product tests: passed, 8 files / 82 tests.
  - Static agent evals: passed.
  - E2B release readiness: passed.
  - E2B Agent doctor: passed.
  - Sandbox template doctor: passed.
- `npm run verify:e2b-release`: passed, and passed again after correcting the skill install path check to `assistantSkillName`.
- `npm --prefix mycc-sandbox test`: passed, 14 tests.
- `npm --prefix mycc-sandbox run doctor:template`: passed.

## Current Go/No-Go Decision

Go:

- Create release branch / split PRs.
- Start staging deployment rehearsal once PR boundaries are clean.
- Use `MYCC_IDE_SESSION_TTL_SECONDS=3600` for the landing cohort unless the target E2B plan explicitly supports longer leases.
- Treat the current local candidate as "release branch preparation ready"; it is not public-launch ready.

No-Go:

- Do not open public landing traffic yet.
- Do not promise a 24-hour always-on sandbox on the default E2B landing path.
- Do not merge dirty worktree wholesale.

Public landing requires:

- Runtime and Sandbox/Desktop PR boundaries respected in clean release branches.
- Staging `db:migrate` completed.
- Staging `/readyz/deep` passing.
- Staging `landing-live` passing.
- Product surface audit showing no P0/P1 provider leaks or dead-end flows.
- Rollback rehearsal completed and documented.

## Recommended Execution Order

Prepare PR 1 first as the coordination and guardrail branch, but do not treat it as the first ready-to-merge production dependency. The full release gate intentionally checks files and behavior introduced by the runtime, sandbox, and skills PRs.

Recommended merge order:

1. PR 3: Backend Runtime and Readiness.
2. PR 2: Skills Product Path.
3. PR 4: Sandbox Template and Desktop.
4. PR 1: Landing Gate and Release Checklist.
5. PR 5: Frontend Product / Workbench.

PR 1 may be opened as a draft before PRs 2-4 so reviewers can see the gate and release checklist. Mark it ready only after PRs 3, 2, and 4 are stacked or merged and the integrated release gate passes.

If PR 3 exposes a runtime/session/readiness contract mismatch, pause PRs 2, 4, 1, and 5 until the runtime contract is settled. If PR 2 exposes a skills/preload source mismatch, pause PRs 4, 1, and 5 until the skills source is settled. If PR 4 exposes a sandbox/template contract mismatch, pause PRs 1 and 5 until the template contract is settled.

## Known Cross-PR Overlaps

These overlaps are intentional and must be checked when stacking or rebasing the PRs:

| Overlap | Resolution |
| --- | --- |
| PR 1 + PR 3: `mycc-backend/scripts/verify-e2b-release-readiness.ts` | PR 1 adds landing/harness/release gate checks. PR 3 adds runtime/readiness/session checks. The integrated file must keep both sets and must not reintroduce a check for non-existent `src/routes/harness.ts`. |
| PR 2 + PR 3: `mycc-backend/src/routes/chat.ts` | PR 2 owns skill-install prompt wording and `~/.claude/skills/<skill-name>`. PR 3 owns Claude home/onboarding path, runtime defaults, request/session/trace behavior, and model pricing fallback. The integrated file must keep both. |
| PR 2 + PR 4: preload skills | PR 2 owns `mycc-backend/src/skills/image-preload-skills.json` as the source-of-truth. PR 4 consumes it through `mycc-sandbox/templates/e2b-assistant-sandbox/skills/.mycc-preload-skills.json` and must not stage the backend source file. |
| PR 2 + PR 5: `ConfirmDialog.tsx`, `DialogShell.tsx`, and `productCopy.ts` | Shared frontend helpers are currently identical where duplicated. Stage helper files once; PR 5 should reuse them rather than redefine them after PR 2 lands. |
| PR 2 + PR 5: `mycc-web-react/src/config/api.ts` | PR 2 owns skills API URL helpers. PR 5 owns workspace URL helpers with optional `ideSessionId` binding. The integrated file must keep both sets. |
| PR 3 + PR 4: `e2b-agent-sdk-bridge-contract.test.ts` and `templates/e2b-code-server/agent-sdk-bridge.mjs` | Current contents are identical. Keep the final bridge contract aligned across runtime and sandbox PRs. |
| PR 3 + PR 4: `mycc-backend/templates/user-workspace/CLAUDE.md` | PR 3 owns the `~/.claude` onboarding/home boundary. PR 4 owns only the visible `CC 的电脑` / browser-use guidance hunk. |

Integration sanity checks already confirmed:

- `chat.ts` keeps `.claude/skills/<skill-name>`, `resolveClaudeHomeDirFromWorkspace`, `OPENCLAW_ABOUT_ME_DIR = "about-me"`, `DEFAULT_CLAUDE_MODEL`, and Opus pricing fallback.
- `verify-e2b-release-readiness.ts` keeps landing harness checks, skill-path checks, deep readiness checks, runtime default checks, and bridge default checks.
- Shared preload/helper/bridge overlap files compare identical across their source PR worktrees as of this coordination update. `config/api.ts` is not identical and must be merged by ownership.

## Ready-to-Open PR Drafts

### PR 3 Draft

Title: `Backend runtime: E2B Agent SDK sessions, trace, readiness, and keepalive`

Body highlights:

- Switches the landing backend path to the E2B Claude Agent SDK runtime.
- Adds run trace storage, IDE session identity, readiness/deep readiness, and near-expiry session keepalive.
- Moves onboarding/user memory initialization toward sandbox home semantics while keeping workspace project-scoped.
- Keeps landing TTL at `3600` seconds and does not promise a 24-hour always-on sandbox.

Verification:

- Runtime focused backend tests passed: 28 files / 163 tests in the PR 3 worktree.
- Backend build passed.
- `npm run verify:e2b-release` passed.
- Integration candidate backend full tests passed.

### PR 4 Draft

Title: `Sandbox template: assistant desktop, browser helpers, and template contracts`

Body highlights:

- Adds the assistant sandbox template with code-server, CCR, Agent SDK bridge, visible browser, desktop/noVNC, and browser-use helpers.
- Keeps E2B traffic private with backend proxying; browser clients do not receive raw E2B hosts or traffic tokens.
- Preloads user-level Claude skills under sandbox home `~/.claude`.
- Aligns docs with the current `mycc-sandbox/templates/e2b-assistant-sandbox` main template.

Verification:

- `npm --prefix mycc-sandbox test` passed, 14 tests.
- `npm --prefix mycc-sandbox run doctor:template` passed.
- Backend template/bridge contract tests passed.
- Backend build passed.

### PR 2 Draft

Title: `Skills product: registry browsing and Claude skill-name install paths`

Body highlights:

- Separates market `skillId`, display name, and Claude-visible `assistantSkillName`.
- Installs skills to `~/.claude/skills/<assistantSkillName>` based on `SKILL.md` frontmatter.
- Allows registry browsing when runtime is unavailable; install/update still require the runtime.
- Adds SkillsPage product flow, detail page, and e2e coverage.

Verification:

- Backend skills/service/routes tests passed, 42 tests.
- Frontend SkillsPage/API tests passed.
- Skills Playwright e2e passed, 2 tests.
- Backend and frontend builds passed.

### PR 1 Draft

Title: `Landing gate: harness verifier, release checklist, and staging guardrails`

Body highlights:

- Adds `landing` and `landing-live` harness targets.
- Adds static agent evals, migration runner checks, release readiness checks, and PR file classification.
- Documents staging, rollback, cost/TTL, and Go/No-Go criteria.
- Guards against stale assumptions such as exposing foreground run trace history or expecting a non-existent `routes/harness.ts`.

Verification:

- PR 1 classifier passed with no unclassified files.
- PR 1 harness/script tests passed.
- PR 1 backend build passed.
- Integration candidate `landing:classify` passed with `needs-owner-review (0)`, `do-not-stage (0)`, and `unclassified (0)`.
- Integration candidate `harness:verify -- --target=landing --no-write` was rerun on 2026-06-26 without local E2B/Claude credentials: backend build, frontend build, backend tests, frontend product tests, static agent evals, E2B release readiness, and sandbox template doctor passed; `doctor:e2b-agent` failed only on missing `MYCC_E2B_API_KEY`/Claude credential. Re-run the full `landing` gate in the target credentialed environment before marking the stack ready for staging.
- `landing-live` still requires staging credentials and a target backend.

### PR 5 Draft

Title: `Frontend product: assistant workbench, files, browser, and copy cleanup`

Body highlights:

- Simplifies the right-side workbench to assistant browser plus project files.
- Removes user-facing run trace / activity panels from the normal frontend path.
- Adds file tree and Monaco preview flow for project files.
- Cleans product copy and settings so normal UI does not expose `linux_user`, `local-user`, provider host, token, or low-level runtime wording.

Verification:

- Release coordinator focused frontend tests passed, 6 files / 44 tests.
- PR 5 sub-agent focused frontend tests passed.
- Frontend build passed.
- Chat-flow Playwright e2e passed after starting the expected local Vite server on `127.0.0.1:3001`; Playwright output artifacts were removed afterward.
- Full integration frontend tests passed, 30 files / 248 tests.

## Coordinator Execution Board

Immediate owner actions:

1. Keep this document as the release coordination source of truth.
2. Use `mycc-backend/docs/landing-dirty-worktree-audit.md` as the mechanical staging guard.
3. Prepare PR 1 first as a draft because it defines the gate and protects the rest of the split from merging by feel.
4. Merge or stack PRs in the order PR 3, PR 2, PR 4, PR 1, PR 5.
5. Prepare all PRs from clean branches or precise hunk staging. Do not stage the current dirty worktree wholesale.

Today's landing target:

- Reach "release branch ready for staging rehearsal", not public launch.
- Public launch remains blocked until staging migrations, `/readyz/deep`, `landing-live`, product audit, and rollback rehearsal are complete.
