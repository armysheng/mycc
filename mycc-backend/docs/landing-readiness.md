# 道友 AI Landing Readiness

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
- Production operations runbook: `mycc-backend/docs/landing-production-runbook.md`
- Verify the current deployed commit live on the host before any release decision:
  `cd /home/armysheng/mycc && git rev-parse --short HEAD`

Latest no-side-effect production evidence from 2026-06-29 CST:

- `GET https://daoyou.iaigc.fun/health`: `200`, `status=ok`.
- `GET https://daoyou.iaigc.fun/readyz`: `200`, `ready=true`.
- `GET https://daoyou.iaigc.fun/readyz/deep` without token: `401`, fixed `readyz_deep_unauthorized` body, no internal `checks/runtime/E2B` payload.
- Remote `/home/armysheng/mycc` was last recorded at `82d2fec`, worktree dirty count is `0`, and `systemctl --user is-active mycc-backend.service` returns `active`.
- `GET https://daoyou.iaigc.fun/api/auth/config`: `registration.mode=closed`, `enabled=false`, `inviteRequired=false`.
- `GET https://daoyou.iaigc.fun/favicon.svg`: `200`, `content-type=image/svg+xml`.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface`: passed; this is no-side-effect and covers public health, readiness, unauthenticated deep readiness privacy, auth registration mode, homepage brand, favicon, and built assets.
- `MYCC_ONBOARDING_ASYNC` is `false_or_unset` in production; async onboarding code is deployed but not yet enabled for live users.
- Home HTML title is `道友 AI`, and the meta description includes `念头通达`.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy`: passed again on deployed commit `23074b0`; rerun at most once per release candidate because it creates failed-login audit/rate-limit events.
- Production deploys now include `mycc-backend/scripts/guard-production-node.sh`; `npm ci/build` must use the same Node v20.19.5 toolchain as systemd.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface`: passed again on deployed commit `23074b0`.
- Browser product-surface audit of `https://daoyou.iaigc.fun/projects/demo?codex_audit=<timestamp>` passed on desktop and 390x844 mobile viewport after cache-busting navigation:
  - Login hero shows `问清楚，再动手。把念头落成结果。`, with `道友 AI` and `念头通达出品` visible.
  - Registration tab shows `暂未开放自助注册，请联系团队开通账号。`; phone, email, password, and submit button are disabled; submit text is `暂未开放注册`.
  - Visible body text did not expose `MyCC`, `linuxUser`, `E2B`, `sandbox`, `token`, `mycc_u`, `大辉哥`, `老板`, or `主人`.
  - A previously observed old login hero was not reproducible after cache-busting navigation and matches a stale browser SPA chunk/cache symptom rather than the deployed asset state.

Current Playwright product-surface evidence from 2026-06-29 CST:

- Desktop viewport `1440x1000` at `/projects/demo?codex_audit=<timestamp>` rendered title `道友 AI`, login hero `问清楚，再动手。把念头落成结果。`, `道友 AI`, and `念头通达出品`.
- Mobile viewport `390x844` rendered the compact login card with `道友 AI` and `念头通达出品`; `documentElement.scrollWidth=390` and `body.scrollWidth=390`, so no horizontal overflow was observed.
- Registration tab was opened without submitting a form. It showed `暂未开放自助注册，请联系团队开通账号。`; phone, email, password, and `暂未开放注册` submit button were disabled.
- Visible body text in the desktop, mobile, and registration-tab audits did not match `MyCC`, `linuxUser`, `E2B`, `sandbox`, `token`, `mycc_u`, `大辉哥`, `老板`, or `主人`.
- Browser console only reported a password-field autocomplete hint; no runtime error was observed during the readonly audit.

Current ops-only production evidence from 2026-06-29 CST:

- Authorized local `GET http://127.0.0.1:8080/readyz/deep` with `MYCC_READYZ_DEEP_TOKEN`: `ready=true`, `status=ok`.
- Deep readiness checks: `database=pass`, `skills=pass`, `runtime=pass` with `E2B Agent preflight ready`; `ssh=skipped` because the configured runtime does not initialize SSH at startup.
- Public unauthenticated `GET https://daoyou.iaigc.fun/readyz/deep` still returns only `401 readyz_deep_unauthorized` and does not expose internal checks.
- Production `schema_migrations` contains 8 applied migrations. Required landing migrations `007-add-agent-run-trace.sql` and `008-add-ide-session-identity.sql` are applied; both were recorded on 2026-06-26T08:34:28Z.

Post-#111 production evidence from 2026-06-29 CST:

- Main commit `23074b069070652b9887e3a3e0c4f534f8d03365` passed GitHub `CI` run `28364261338`: `frontend-ci`, `backend-ci`, and `sandbox-ci` all succeeded.
- GitHub `Deploy Staging` run `28364322947` succeeded for commit `23074b069070652b9887e3a3e0c4f534f8d03365`, including backend health, deep readiness, and frontend endpoint verification.
- Remote `/home/armysheng/mycc` is deployed at `23074b0`, worktree dirty count is `0`, and `systemctl --user is-active mycc-backend.service` returns `active`.
- Local production `GET /health` and `GET /readyz` over SSH returned success.
- `mycc-sandbox npm run doctor:template` now passes on production: credentials are present and `e2b-template-exists` reports `Template mycc-assistant-sandbox-dev exists`.
- Production Node guard passes with Node `v20.19.5`, and `npm run doctor:e2b-agent` reports E2B Agent preflight ready.
- `curl -fsSIL https://daoyou.iaigc.fun` returned `HTTP/1.1 200 OK`, and `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface` passed.

Post-#112 local release evidence from 2026-06-29 CST:

- Latest main commit `771417976adc7ce61e51b9d56b51d2cc05ee2064` is docs-only after the production deployment commit `23074b0`; Deploy Staging run `28364806650` classified it as non-deploying and skipped remote SSH deployment.
- `npm run harness:verify -- --target=landing --no-write` on commit `7714179` completed 7 of 8 sub-gates successfully: backend build, frontend build, backend tests, frontend product tests, static agent evals, E2B release readiness, and sandbox template doctor.
- The only local landing gate failure was `e2b-agent`, caused by missing local `MYCC_E2B_API_KEY` or `E2B_API_KEY` and missing local Claude credential. Production `doctor:e2b-agent` and `mycc-sandbox doctor:template` passed on deployed commit `23074b0`.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy` passed on deployed commit `23074b0`; this performs one failed-login privacy probe and does not register, initialize onboarding, create E2B sessions, or call chat.

Post-#119 production evidence from 2026-06-29 CST:

- Main commit `7b2b4f25bcfa10364f120ea99f0e74a05d10d9a9` passed GitHub `CI` run `28370295997`: `frontend-ci`, `backend-ci`, and `sandbox-ci` all succeeded.
- GitHub `Deploy Staging` run `28370370431` succeeded for commit `7b2b4f25bcfa10364f120ea99f0e74a05d10d9a9`, including backend health, deep readiness, and frontend endpoint verification.
- Remote `/home/armysheng/mycc` is deployed at `7b2b4f2`, `prod_dirty_count=0`, and `systemctl --user is-active mycc-backend.service` returns `active`.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface` passed on deployed commit `7b2b4f2`.
- Production Node guard passes with Node `v20.19.5`, and `npm run doctor:e2b-agent` reports E2B Agent preflight ready.
- `npm run verify:rollback-preflight` is now part of the local no-side-effect release gate before live smoke or rollback rehearsal.

Post-#121 production evidence from 2026-06-29 CST:

- Main commit `82d2fec7c47529aec3d9f5801f4b39b9d5283f9d` passed GitHub `CI` run `28373993080`: `frontend-ci`, `backend-ci`, and `sandbox-ci` all succeeded.
- GitHub `Deploy Staging` run `28374057187` succeeded for commit `82d2fec7c47529aec3d9f5801f4b39b9d5283f9d`, including backend health and deep readiness verification.
- Remote `/home/armysheng/mycc` was deployed at `82d2fec`, `prod_dirty_count=0`, and `systemctl --user is-active mycc-backend.service` returned `active`.
- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface` passed on deployed commit `82d2fec`.
- Production Node guard passes with Node `v20.19.5`, and `npm run doctor:e2b-agent` reports E2B Agent preflight ready.
- `smoke:public-surface` now reports the failing check label, full URL, and nested `Error.cause` when a network fetch throws, so transient DNS/TLS/connectivity failures are diagnosable.

The core path is proven when all of these are true:

- Backend builds successfully.
- Frontend builds successfully.
- Backend tests pass.
- Product-facing frontend tests pass.
- Static product-facing agent evals pass.
- E2B release readiness gate passes.
- E2B Agent doctor is ready.
- Sandbox template doctor is ready.
- No-side-effect public surface live smoke passes against the target environment.
- Low-side-effect auth privacy live smoke passes against the target environment.
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
MYCC_LIVE_GATE_APPROVED=1 BASE_URL=https://daoyou.iaigc.fun npm run harness:verify -- --target=landing-live --no-write
```

Use the actual staging or production URL for `BASE_URL`. Run the low-side-effect
auth privacy probe before any live smoke with larger side effects:

Production runbook note: before running any `npm run smoke:*` or `npm run harness:verify` command in production, use the Node20 guard and make both local binaries and the guarded Node bin first-class PATH entries, for example `NODE_BIN_DIR="$(./scripts/guard-production-node.sh --print-bin-dir)"` followed by `export PATH="$PWD/node_modules/.bin:$NODE_BIN_DIR:$PATH"`, to avoid `tsx: not found`.

```bash
BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface
BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy
BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-onboarding
```

`smoke:auth-onboarding` registers or logs in a test identity, initializes onboarding, and may create or reuse workspace/E2B state. Do not run it casually against production without recording the test identity and cleanup expectation. If `/api/auth/config` reports `registration.mode=closed`, provide an existing test account with `MYCC_AUTH_SMOKE_CREDENTIAL` (or `MYCC_AUTH_SMOKE_EMAIL` / `MYCC_AUTH_SMOKE_PHONE`) plus `MYCC_AUTH_SMOKE_PASSWORD`; invite-only targets can provide `MYCC_AUTH_SMOKE_INVITE_CODE` for new-account registration.

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

### Remaining Live Validation Matrix

| Category | Check | Current state | Authorization / side effect |
| --- | --- | --- | --- |
| No-side-effect public checks | `GET /health`, `GET /readyz`, public unauthenticated `GET /readyz/deep`, `GET /api/auth/config`, `smoke:public-surface` | Passed on 2026-06-29 in post-#121 evidence; verify the current deployed commit live before release decisions. | No extra authorization needed. |
| Auth privacy smoke | `smoke:auth-privacy` | Passed on 2026-06-29 against deployed commit `23074b0`; generic credential error confirmed | Creates one failed-login audit/rate-limit event; no registration, onboarding, E2B session, or chat. |
| Browser product surface | Desktop and 390x844 mobile browser audit of `/projects/demo` login/register surface | Passed again on 2026-06-29 with Playwright: desktop login, mobile login, registration closed state, no forbidden public text, no mobile horizontal overflow | No account action, no form submission. |
| Ops-only readiness | Authorized local/SSH `GET /readyz/deep` with `MYCC_READYZ_DEEP_TOKEN`; production Node guard; E2B agent doctor; sandbox template doctor | Passed on 2026-06-29: database/skills/runtime pass; SSH skipped by runtime config; Node v20.19.5 guard pass; E2B Agent preflight ready; sandbox template exists | Requires ops token for deep readiness; do not expose internal checks publicly. |
| Database migrations | Read-only `schema_migrations` query for landing migrations `007` and `008` | Passed on 2026-06-29: both required migrations are applied | No migration was executed. |
| Auth and onboarding live smoke | `smoke:auth-onboarding` with explicit existing test identity while registration is closed | Still required | Uses a real test account and may initialize workspace/E2B state. |
| E2B live smokes | IDE, desktop, and Agent SDK workspace smoke tests | Still required | Creates real E2B sessions/workspace markers and may consume model/runtime resources; cleanup must be recorded. |
| Full live gate | `MYCC_LIVE_GATE_APPROVED=1 BASE_URL=<target> npm run harness:verify -- --target=landing-live --no-write` | Still required | Bundles auth/onboarding and E2B live checks; run only as a recorded release-candidate gate. |
| Rollback rehearsal | Config-only fallback to `remote-claude` / `IDE disabled` / `workspace ssh`, restart, cleanup, health checks | Still required | Requires planned operations window and release owner notes. |
| Live gate decision packet | `landing-production-runbook.md` approval packet | Documented; must be filled before live smoke or rollback rehearsal | Records owner, test identity label, approved checks, side effects, cleanup expectation, abort threshold, and evidence owner. |

1. Release boundary cleanup
   - Decide which dirty worktree changes belong to the landing branch.
   - Split unrelated experiments, generated artifacts, and old redesign folders out of the release candidate.
   - Run `npm run landing:classify -- --fail-on-unclassified` from `mycc-backend` before staging files.
   - Confirm migrations `007` and `008` are included and applied. Completed on 2026-06-29 by read-only `schema_migrations` query.

2. Staging deployment rehearsal
   - Public staging preview is deployed at `https://daoyou.iaigc.fun`.
   - Confirm whether the deployed backend commit includes all release-candidate migrations. Current target has `001` through `008` recorded.
   - Run `npm run db:migrate` only when cutting a new release candidate with unapplied migrations, or explicitly prove it is a no-op.
   - Verify authorized `GET /readyz/deep` over SSH/localhost returns `runtime.status=pass`; public unauthenticated requests must stay 401/403 without internal details.
   - Run `BASE_URL=<staging-backend> npm run smoke:public-surface` before auth or E2B checks.
   - Run `BASE_URL=<staging-backend> npm run smoke:auth-privacy` before any larger live check with side effects; record the failed-login audit/rate-limit side effect.
   - Run `BASE_URL=<staging-backend> npm run smoke:auth-onboarding` before model-consuming smoke.
   - Run `MYCC_LIVE_GATE_APPROVED=1 BASE_URL=<staging-backend> npm run harness:verify -- --target=landing-live --no-write`.
   - Fill the production runbook live gate decision packet before running any live smoke against the public target.

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
