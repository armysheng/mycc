# MyCC Landing Readiness

This is the formal landing checklist for turning the current E2B + Claude Agent SDK product path into a public release.

## Current Stage

Status: public staging preview live; guided friendly-test candidate, not unrestricted public launch.

Current public preview:

- Product name: `道友 AI`
- Company name: `念头通达`
- Public URL: `https://daoyou.iaigc.fun`
- Host: current core `136.110.125.242`
- Frontend root: `/var/www/daoyou.iaigc.fun`
- Backend proxy target: `127.0.0.1:8080`
- Backend service: user systemd `mycc-backend.service`
- Deployed commit after the latest landing maintenance pass: `84d5b8c6006368682149b7c3af3222731e177e4c`

Current no-side-effect production evidence from 2026-06-27 CST:

- `GET https://daoyou.iaigc.fun/health`: `200`, `status=ok`.
- `GET https://daoyou.iaigc.fun/readyz`: `200`, `ready=true`.
- `GET https://daoyou.iaigc.fun/readyz/deep` without token: `401`, fixed `readyz_deep_unauthorized` body, no internal `checks/runtime/E2B` payload.
- `POST https://daoyou.iaigc.fun/api/auth/login` with a random nonexistent credential: `401`, generic `手机号/邮箱或密码错误`, no account-existence leak.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy`: passed on 2026-06-27 CST.
- Production deploys now include `mycc-backend/scripts/guard-production-node.sh`; `npm ci/build` must use the same Node v20.19.5 toolchain as systemd.

The core path is proven when all of these are true:

- Backend builds successfully.
- Frontend builds successfully.
- Backend tests pass.
- Product-facing frontend tests pass.
- Static product-facing agent evals pass.
- E2B release readiness gate passes.
- E2B Agent doctor is ready.
- Sandbox template doctor is ready.
- No-side-effect auth privacy live smoke passes against the target environment.
- No-model auth/onboarding live smoke passes against the target environment, with expected registration/onboarding side effects.
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

Use the actual staging or production internal backend URL for `BASE_URL`. Run no-side-effect auth privacy before any live smoke with side effects:

Production runbook note: before running any `npm run smoke:*` or `npm run harness:verify` command in production, use the Node20 guard and make both local binaries and the guarded Node bin first-class PATH entries, for example `NODE_BIN_DIR="$(./scripts/guard-production-node.sh --print-bin-dir)"` followed by `export PATH="$PWD/node_modules/.bin:$NODE_BIN_DIR:$PATH"`, to avoid `tsx: not found`.

```bash
BASE_URL=http://localhost:8080 npm run smoke:auth-privacy
BASE_URL=http://localhost:8080 npm run smoke:auth-onboarding
```

`smoke:auth-onboarding` registers or logs in a test identity, initializes onboarding, and may create or reuse workspace/E2B state. Do not run it casually against production without recording the test identity and cleanup expectation.

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
MYCC_READYZ_DEEP_TOKEN=<strong ops-only token>
```

Claude provider credentials should be configured through MyCC/CCR-specific variables. Do not put global `OPENAI_BASE_URL` or `OPENAI_API_KEY` into the backend process.

`/readyz/deep` is an operations-only endpoint because it includes database, SSH, skills, and runtime detail. Verify it over SSH or another internal channel with `Authorization: Bearer ${MYCC_READYZ_DEEP_TOKEN}` against `http://127.0.0.1:8080/readyz/deep`; public unauthenticated requests must receive only the fixed unauthorized response and no `checks` payload.

For the landing cohort, keep the E2B session TTL at 3600 seconds unless the target E2B plan explicitly supports longer leases. Keepalive may renew near-expiring sessions, but the product should not promise a 24-hour always-on sandbox on the default landing path.

## Remaining Work Before Public Landing

1. Release boundary cleanup
   - Decide which dirty worktree changes belong to the landing branch.
   - Split unrelated experiments, generated artifacts, and old redesign folders out of the release candidate.
   - Run `npm run landing:classify -- --fail-on-unclassified` from `mycc-backend` before staging files.
   - Confirm migrations `007` and `008` are included and applied.

2. Staging deployment rehearsal
   - Public staging preview is deployed at `https://daoyou.iaigc.fun`.
   - Confirm whether the deployed backend commit includes all release-candidate migrations.
   - Run `npm run db:migrate` against the target database when cutting the release candidate, or explicitly prove it is a no-op.
   - Verify authorized `GET /readyz/deep` over SSH/localhost returns `runtime.status=pass`; public unauthenticated requests must stay 401/403 without internal details.
   - Run `BASE_URL=<staging-backend> npm run smoke:auth-privacy` before any live check with side effects.
   - Run `BASE_URL=<staging-backend> npm run smoke:auth-onboarding` before model-consuming smoke.
   - Run `BASE_URL=<staging-backend> npm run harness:verify -- --target=landing-live --no-write`.

3. Product copy and surface audit
   - Initial public brand copy is `道友 AI / 念头通达出品`.
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
- `landing-live` passes against `https://daoyou.iaigc.fun` or the equivalent staging backend target.
- Rollback has been rehearsed once.
- Product UI audit has no P0/P1 provider-leak or dead-end issues.

Ship publicly when:

- The gray cohort has completed a real assistant task using chat, files, browser/desktop, and skill flow.
- No stale running E2B sessions remain after the cohort test.
- The release owner can point to the latest `landing-live` report and rollback notes.
