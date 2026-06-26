# MyCC Landing PR Staging Plan

This file is the exact staging guard for the landing split. It exists to prevent accidental `git add -A` on the dirty worktrees.

Do not run these commands until the release owner explicitly authorizes staging/commit/push. After staging each PR, run:

```bash
git diff --cached --name-only | sort
git diff --cached --check
```

## PR 3: Backend Runtime

Worktree: `/Users/armysheng/workspace/mycc-landing-pr3`

Use explicit runtime paths:

```bash
git add \
  mycc-backend/.env.example \
  mycc-backend/db/schema.sql \
  mycc-backend/db/migrations/007-add-agent-run-trace.sql \
  mycc-backend/db/migrations/008-add-ide-session-identity.sql \
  mycc-backend/scripts/smoke-e2b-agent-workspace.ts \
  mycc-backend/scripts/verify-e2b-release-readiness.ts \
  mycc-backend/src/adapters/remote-claude-adapter.ts \
  mycc-backend/src/agent-runtime \
  mycc-backend/src/auth/service.ts \
  mycc-backend/src/auth/service.test.ts \
  mycc-backend/src/ide \
  mycc-backend/src/index.ts \
  mycc-backend/src/routes/assistant.test.ts \
  mycc-backend/src/routes/chat.ts \
  mycc-backend/src/routes/chat.e2b-context.test.ts \
  mycc-backend/src/routes/chat.onboarding.test.ts \
  mycc-backend/src/routes/chat.runtime-config.test.ts \
  mycc-backend/src/routes/ide.test.ts \
  mycc-backend/src/routes/onboarding.ts \
  mycc-backend/src/routes/onboarding.test.ts \
  mycc-backend/src/routes/workspace.ts \
  mycc-backend/src/routes/workspace.test.ts \
  mycc-backend/src/startup/readiness.ts \
  mycc-backend/src/startup/readiness.test.ts \
  mycc-backend/src/startup/ssh-startup.ts \
  mycc-backend/src/workspace \
  mycc-backend/templates/e2b-code-server/agent-sdk-bridge.mjs \
  mycc-backend/templates/user-workspace/CLAUDE.md
```

Do not stage skills product UI, sandbox template files, PR1 harness docs, or PR5 frontend files in PR3.

## PR 2: Skills Product

Worktree: `/Users/armysheng/workspace/mycc-landing-pr2`

Stage skills source-of-truth before PR4:

```bash
git add \
  docs/mycc-skill-center-integration.md \
  mycc-backend/src/routes/chat.ts \
  mycc-backend/src/routes/skills.ts \
  mycc-backend/src/routes/skills.test.ts \
  mycc-backend/src/skills \
  mycc-web-react/src/api/skills.ts \
  mycc-web-react/src/components/SkillsPage.tsx \
  mycc-web-react/src/components/SkillsPage.test.tsx \
  mycc-web-react/src/components/ui \
  mycc-web-react/src/config/api.ts \
  mycc-web-react/src/utils/productCopy.ts \
  mycc-web-react/tests/e2e/skills
```

Important:

- PR2 owns `mycc-backend/src/skills/image-preload-skills.json`.
- PR2 owns the first copy of shared helpers `ConfirmDialog.tsx`, `DialogShell.tsx`, `InlineAlert.tsx`, and `productCopy.ts`.
- Keep `mycc-backend/src/routes/chat.ts` limited to the skill installer prompt hunk.

## PR 4: Sandbox Template

Worktree: `/Users/armysheng/workspace/mycc-landing-pr4`

Never use `git add -A` in PR4. There is a local untracked copy of `mycc-backend/src/skills/image-preload-skills.json` used only so sandbox tests can run before PR2 is in the base. It must not be staged in PR4.

Use:

```bash
git add \
  docs/mycc-assistant-sandbox-integration.md \
  docs/plans/2026-05-29-e2b-codeserver-sandbox-poc.md \
  mycc-backend/src/ide/e2b-agent-sdk-bridge-contract.test.ts \
  mycc-backend/templates/e2b-code-server/README.md \
  mycc-backend/templates/e2b-code-server/agent-sdk-bridge.mjs \
  mycc-backend/templates/e2b-code-server/e2b.Dockerfile \
  mycc-backend/templates/user-workspace/CLAUDE.md \
  mycc-sandbox
```

Then verify:

```bash
git diff --cached --name-only | grep -v '^mycc-backend/src/skills/image-preload-skills.json$'
test -z "$(git diff --cached --name-only | grep '^mycc-backend/src/skills/image-preload-skills.json$' || true)"
```

PR4 should include `mycc-sandbox/templates/e2b-assistant-sandbox/skills/.mycc-preload-skills.json`; it consumes the PR2 preload source.

## PR 1: Landing Gate

Worktree: `/Users/armysheng/workspace/mycc-landing-pr1`

Stage only release gate, harness, CI, docs, and staging scripts:

```bash
git add \
  .github/workflows/ci.yml \
  .github/workflows/deploy-staging.yml \
  scripts \
  docs/harness \
  evals \
  mycc-backend/DEPLOYMENT.md \
  mycc-backend/README.md \
  mycc-backend/docs/e2b-release-readiness.md \
  mycc-backend/docs/landing-dirty-worktree-audit.md \
  mycc-backend/docs/landing-pr-coordination.md \
  mycc-backend/docs/landing-pr-staging-plan.md \
  mycc-backend/docs/landing-pr-submit-checklist.md \
  mycc-backend/docs/landing-readiness.md \
  mycc-backend/package.json \
  mycc-backend/package-lock.json \
  mycc-backend/scripts/agent-eval-static.ts \
  mycc-backend/scripts/apply-migrations.ts \
  mycc-backend/scripts/harness-verify.ts \
  mycc-backend/scripts/landing-pr-classify.ts \
  mycc-backend/scripts/smoke-e2b-desktop.ts \
  mycc-backend/scripts/smoke-e2b-ide.ts \
  mycc-backend/scripts/verify-e2b-release-readiness.ts \
  mycc-backend/src/harness \
  mycc-backend/src/scripts
```

## PR 5: Frontend Product

Worktree: `/Users/armysheng/workspace/mycc-landing-pr5`

Stack PR5 after PR2. If PR2 is in the base, do not re-stage unchanged shared helper files that PR2 already introduced.

Use:

```bash
git add \
  mycc-web-react/package.json \
  mycc-web-react/package-lock.json \
  mycc-web-react/playwright.config.ts \
  mycc-web-react/src/App.tsx \
  mycc-web-react/src/App.test.tsx \
  mycc-web-react/src/components/ChatPage.tsx \
  mycc-web-react/src/components/ChatPage.workbench.test.tsx \
  mycc-web-react/src/components/MessageComponents.tsx \
  mycc-web-react/src/components/MessageComponents.test.tsx \
  mycc-web-react/src/components/assistant \
  mycc-web-react/src/components/chat \
  mycc-web-react/src/components/layout/Sidebar.tsx \
  mycc-web-react/src/components/layout/Sidebar.test.tsx \
  mycc-web-react/src/components/settings/GeneralSettings.tsx \
  mycc-web-react/src/components/settings/GeneralSettings.test.tsx \
  mycc-web-react/src/config/api.ts \
  mycc-web-react/src/config/api.test.ts \
  mycc-web-react/src/test \
  mycc-web-react/src/types.ts \
  mycc-web-react/src/utils/UnifiedMessageProcessor.test.ts \
  mycc-web-react/src/utils/apiError.ts \
  mycc-web-react/src/utils/productCopy.test.ts \
  mycc-web-react/src/utils/workbenchActivity.ts \
  mycc-web-react/src/utils/workbenchActivity.test.ts \
  mycc-web-react/src/vite-env.d.ts \
  mycc-web-react/tests/e2e/chat-flow \
  mycc-web-react/tests/e2e/fixtures \
  mycc-web-react/vite.config.ts
```

If PR2 is not yet in the base and PR5 must be opened standalone, also stage `mycc-web-react/src/components/ui/ConfirmDialog.tsx`, `mycc-web-react/src/components/ui/DialogShell.tsx`, and `mycc-web-react/src/utils/productCopy.ts`. In the preferred stack, those come from PR2.

Before committing PR5, ensure no Playwright artifacts are staged:

```bash
test -z "$(git status --short | grep '^?? output/' || true)"
```
