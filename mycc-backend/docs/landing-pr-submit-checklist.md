# MyCC Landing PR Submit Checklist

This checklist turns the landing split into concrete PR preparation steps. It complements `landing-pr-coordination.md`.

Status as of 2026-06-26 Asia/Shanghai:

- No landing PR branch has an upstream configured yet.
- No GitHub PR currently exists for `codex/landing-gate-pr1`, `codex/landing-skills-pr2`, `codex/landing-runtime-pr3`, `codex/landing-sandbox-pr4`, or `codex/landing-frontend-pr5`.
- Current release worktrees are still uncommitted diffs. Do not stage the main dirty workspace wholesale.
- Existing worker threads have re-audited PR 2, PR 3, and PR 4 in their own worktrees; a PR 5 sub-agent audit also completed.

## Submit Order

Open PR 1 as a draft if reviewers need to see the release gate early. Merge or stack in this order:

1. PR 3: Backend Runtime and Readiness.
2. PR 2: Skills Product Path.
3. PR 4: Sandbox Template and Desktop.
4. PR 1: Landing Gate and Release Checklist.
5. PR 5: Frontend Product / Workbench.

PR 1 becomes ready only after PRs 3, 2, and 4 are stacked or merged and the integrated release gate passes.

## PR 3: Backend Runtime and Readiness

Worktree:

```bash
/Users/armysheng/workspace/mycc-landing-pr3
```

Branch:

```bash
codex/landing-runtime-pr3
```

Title:

```text
Backend runtime: E2B Agent SDK sessions, trace, readiness, and keepalive
```

Pre-submit checks:

```bash
cd /Users/armysheng/workspace/mycc-landing-pr3/mycc-backend
npm test -- --run src/auth/service.test.ts src/routes/onboarding.test.ts src/workspace/user-workspace-template.test.ts src/agent-runtime src/ide src/startup/readiness.test.ts src/routes/chat.e2b-context.test.ts src/routes/chat.runtime-config.test.ts src/routes/assistant.test.ts src/routes/workspace.test.ts
npm run build
npm run verify:e2b-release
git -C /Users/armysheng/workspace/mycc-landing-pr3 diff --check
```

Before opening:

- Confirm `src/routes/chat.ts` keeps PR 3 runtime/home/model changes.
- Confirm final integration still keeps PR 2's `.claude/skills/<skill-name>` installer prompt.
- Confirm TTL wording stays at `3600` / near-expiry keepalive, not 24-hour always-on.

## PR 2: Skills Product Path

Worktree:

```bash
/Users/armysheng/workspace/mycc-landing-pr2
```

Branch:

```bash
codex/landing-skills-pr2
```

Title:

```text
Skills product: registry browsing and Claude skill-name install paths
```

Pre-submit checks:

```bash
cd /Users/armysheng/workspace/mycc-landing-pr2/mycc-backend
npm test -- --run src/routes/skills.test.ts src/skills/remote-skill-store.test.ts src/skills/skills-service.test.ts src/skills/index.test.ts src/skills/skill-registry.test.ts
npm run build
cd ../mycc-web-react
npm test -- --run src/components/SkillsPage.test.tsx src/api/skills.test.ts
npm run build
npx playwright test tests/e2e/skills --project=chromium
git -C /Users/armysheng/workspace/mycc-landing-pr2 diff --check
```

Before opening:

- Confirm market `skillId`, display name, and `assistantSkillName` remain separate.
- Confirm install paths use `~/.claude/skills/<assistantSkillName>`.
- Confirm registry browsing works when runtime is unavailable.
- Confirm `config/api.ts` keeps skills URL helpers. Final integration must also keep PR 5 workspace `ideSessionId` helpers.

## PR 4: Sandbox Template and Desktop

Worktree:

```bash
/Users/armysheng/workspace/mycc-landing-pr4
```

Branch:

```bash
codex/landing-sandbox-pr4
```

Title:

```text
Sandbox template: assistant desktop, browser helpers, and template contracts
```

Pre-submit checks:

```bash
cd /Users/armysheng/workspace/mycc-landing-pr4
npm --prefix mycc-sandbox test
npm --prefix mycc-sandbox run doctor:template
cd mycc-backend
npm test -- --run src/ide/e2b-agent-sdk-bridge-contract.test.ts src/ide/e2b-template-contract.test.ts
npm run build
git -C /Users/armysheng/workspace/mycc-landing-pr4 diff --check
```

Before opening:

- Exclude `mycc-backend/src/skills/image-preload-skills.json`; PR 2 owns it as the skills source-of-truth.
- Confirm `mycc-sandbox/templates/e2b-assistant-sandbox/skills/.mycc-preload-skills.json` consumes the PR 2 preload list.
- Confirm bridge contract files remain aligned with PR 3.
- Keep only the sandbox/browser-use hunk in `mycc-backend/templates/user-workspace/CLAUDE.md`; PR 3 owns the `~/.claude` onboarding/home boundary.

## PR 1: Landing Gate and Release Checklist

Worktree:

```bash
/Users/armysheng/workspace/mycc-landing-pr1
```

Branch:

```bash
codex/landing-gate-pr1
```

Title:

```text
Landing gate: harness verifier, release checklist, and staging guardrails
```

Pre-submit checks:

```bash
cd /Users/armysheng/workspace/mycc-landing-pr1/mycc-backend
npm run landing:classify -- --fail-on-unclassified
npm test -- --run src/harness src/scripts
npm run build
git -C /Users/armysheng/workspace/mycc-landing-pr1 diff --check
```

Integrated checks after PRs 3, 2, and 4 are stacked:

```bash
cd /Users/armysheng/workspace/mycc-landing-integration/mycc-backend
npm run landing:classify -- --fail-on-unclassified
npm run verify:e2b-release
npm run harness:verify -- --target=landing --no-write
```

Before marking ready:

- Confirm no check for non-existent `src/routes/harness.ts`.
- Confirm the release gate keeps runtime, skills path, sandbox template, migrations, and rollback checks.
- Confirm `landing-live` remains a staging/live gate, not a local no-credential promise.
- Run the full `landing` gate with `MYCC_E2B_API_KEY` plus Claude credentials available. In a no-credential local shell, `doctor:e2b-agent` is expected to fail even when builds, tests, static evals, E2B release readiness, and sandbox template checks pass.

## PR 5: Frontend Product / Workbench

Worktree:

```bash
/Users/armysheng/workspace/mycc-landing-pr5
```

Branch:

```bash
codex/landing-frontend-pr5
```

Title:

```text
Frontend product: assistant workbench, files, browser, and copy cleanup
```

Pre-submit checks:

```bash
cd /Users/armysheng/workspace/mycc-landing-pr5/mycc-web-react
npm test -- --run src/App.test.tsx src/components/ChatPage.workbench.test.tsx src/components/chat/ChatRuntimeStatusBadge.test.tsx src/components/settings/GeneralSettings.test.tsx src/config/api.test.ts src/utils/productCopy.test.ts
npm run build
npx playwright test tests/e2e/chat-flow/chat-flow.spec.ts --project=chromium
git -C /Users/armysheng/workspace/mycc-landing-pr5 diff --check
```

Before the Playwright command, start `npm run dev:codex` in a second terminal so `127.0.0.1:3001` is available. Stop that temporary server and remove any `output/` artifacts before staging.

Before opening:

- Confirm normal UI does not expose `linux_user`, `local-user`, E2B, sandbox, raw host, token, traffic token, or low-level runtime copy.
- Confirm the workbench product path is assistant browser plus project files, without foreground run trace/activity panels.
- Confirm `config/api.ts` keeps workspace URL helpers with optional `ideSessionId`. Final integration must also keep PR 2 skills URL helpers.
- Confirm no Playwright `output/` artifacts are left in the PR worktree after e2e.

## Staging Rehearsal After PR Stack

Run on the target staging environment:

```bash
cd mycc-backend
npm run db:migrate
MYCC_LIVE_GATE_APPROVED=1 BASE_URL=<staging-backend-url> npm run harness:verify -- --target=landing-live --no-write
```

Manual checks:

- `/readyz/deep` returns runtime status pass.
- Product surface audit has no P0/P1 provider leaks or dead-end flows.
- Rollback rehearsal works with `MYCC_AGENT_RUNTIME=remote-claude`, `MYCC_IDE_PROVIDER=disabled`, and `MYCC_WORKSPACE_PROVIDER=ssh`.
- Expired E2B sessions are cleaned after smoke tests.
