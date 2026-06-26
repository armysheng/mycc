# MyCC Landing Readiness

This is the formal landing checklist for turning the current E2B + Claude Agent SDK product path into a public release.

## Current Stage

Status: P2 complete, landing candidate.

The core path is proven when all of these are true:

- Backend builds successfully.
- Frontend builds successfully.
- Backend tests pass.
- Product-facing frontend tests pass.
- Static product-facing agent evals pass.
- E2B release readiness gate passes.
- E2B Agent doctor is ready.
- Sandbox template doctor is ready.
- Live E2B IDE, desktop, and Agent SDK workspace smoke tests pass against the target environment.

## Landing Gates

Run the non-live landing candidate gate before cutting a release branch:

```bash
cd mycc-backend
npm run harness:verify -- --target=landing --no-write
```

This gate includes backend build, frontend build, backend Vitest, focused product-facing frontend tests, static agent evals, E2B release readiness, E2B Agent doctor, and sandbox template doctor.

Run the live landing gate against the target backend before public traffic:

```bash
cd mycc-backend
BASE_URL=http://localhost:8080 npm run harness:verify -- --target=landing-live --no-write
```

Use the actual staging or production internal backend URL for `BASE_URL`.

## Required Environment

The landing path expects:

```bash
MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
MYCC_IDE_SESSION_TTL_SECONDS=3600
MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep,Bash,Edit,Write
MYCC_AGENT_SDK_PERMISSION_MODE=bypassPermissions
MYCC_AGENT_RUN_STORE=postgres
```

Claude provider credentials should be configured through MyCC/CCR-specific variables. Do not put global `OPENAI_BASE_URL` or `OPENAI_API_KEY` into the backend process.

For the landing cohort, keep the E2B session TTL at 3600 seconds unless the target E2B plan explicitly supports longer leases. Keepalive may renew near-expiring sessions, but the product should not promise a 24-hour always-on sandbox on the default landing path.

## Remaining Work Before Public Landing

1. Release boundary cleanup
   - Decide which dirty worktree changes belong to the landing branch.
   - Split unrelated experiments, generated artifacts, and old redesign folders out of the release candidate.
   - Run `npm run landing:classify -- --fail-on-unclassified` from `mycc-backend` before staging files.
   - Confirm migrations `007` and `008` are included and applied.

2. Staging deployment rehearsal
   - Deploy the release candidate to staging.
   - Run `npm run db:migrate`.
   - Verify `GET /readyz/deep` returns `runtime.status=pass`; the staging deploy workflow defaults `STAGING_BACKEND_READY_URL` to `http://127.0.0.1:8080/readyz/deep` and rejects responses where runtime readiness is not `pass`.
   - Run `BASE_URL=<staging-backend> npm run harness:verify -- --target=landing-live --no-write`.

3. Product copy and surface audit
   - Verify normal user UI does not expose provider details such as `linuxUser`, E2B, sandbox, raw token, traffic token, noVNC raw URL, or code-server host.
   - Verify failure states are product-facing and actionable.
   - Verify the first screen is usable as an assistant product, not an engineering diagnostic page.

4. Operations rollback rehearsal
   - Confirm config-only rollback switches:
     - `MYCC_AGENT_RUNTIME=remote-claude`
     - `MYCC_IDE_PROVIDER=disabled`
     - `MYCC_WORKSPACE_PROVIDER=ssh`
   - Restart backend.
   - Run `npm run cleanup:ide-sessions`.
   - Confirm `/health` and the fallback chat path work.

5. Cost and cleanup guard
   - Confirm expired E2B sessions are cleaned.
   - Confirm live smoke cleanup completes.
   - Confirm keepalive settings are intentional for the landing cohort.

## Landing Decision

Ship to gray traffic when:

- `landing` passes on the release candidate branch.
- `landing-live` passes on staging.
- Rollback has been rehearsed once.
- Product UI audit has no P0/P1 provider-leak or dead-end issues.

Ship publicly when:

- The gray cohort has completed a real assistant task using chat, files, browser/desktop, and skill flow.
- No stale running E2B sessions remain after the cohort test.
- The release owner can point to the latest `landing-live` report and rollback notes.
