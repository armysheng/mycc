# 道友 AI Landing Production Runbook

Date: 2026-06-29

This runbook is the operator checklist for `https://daoyou.iaigc.fun`.
It is intentionally conservative: production checks are split by side effect
level, and anything that creates users, workspaces, sandboxes, chat messages,
database changes, or service restarts needs an explicit release decision.

## Current Production Facts

- Product: `道友 AI`
- Company: `念头通达`
- Domain: `https://daoyou.iaigc.fun`
- Host: `armysheng@136.110.125.242`
- Repository path: `/home/armysheng/mycc`
- Frontend root: `/var/www/daoyou.iaigc.fun`
- Backend proxy target: `127.0.0.1:8080`
- Backend service: user systemd `mycc-backend.service`
- Current deployed commit: `edff4b8`
- Current production state checked on 2026-06-29 CST:
  - Remote worktree dirty count: `0`
  - `systemctl --user is-active mycc-backend.service`: `active`
  - `GET /health`: `200`
  - `GET /readyz`: `200`, `ready=true`
  - Unauthenticated `GET /readyz/deep`: `401`, `readyz_deep_unauthorized`
  - Authorized local `GET /readyz/deep` with `MYCC_READYZ_DEEP_TOKEN`: `ready=true`, `database=pass`, `skills=pass`, `runtime=pass`, `ssh=skipped`
  - `GET /api/auth/config`: `registration.mode=closed`, `enabled=false`
  - `GET /favicon.svg`: `200`, `content-type=image/svg+xml`
  - `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface`: passed
  - `MYCC_ONBOARDING_ASYNC`: `false_or_unset`
  - Home HTML title: `道友 AI`
  - Home meta description includes `念头通达`

Always use `systemctl --user` for backend service checks. System-level
`systemctl status mycc-backend.service` can report a misleading inactive state
for this user service.

## Guardrails

Allowed without an extra release decision:

- Public read-only probes: `/health`, `/readyz`, unauthenticated `/readyz/deep`.
- Static homepage checks that do not log in.
- `smoke:public-surface`, because it only reads public health/readiness/auth config,
  homepage HTML, favicon, and built static assets.
- Remote git status, service status, and redacted environment shape checks.
- Local `landing`, `e2b-release`, classifier, build, and test gates in a clean
  worktree.
- `smoke:auth-privacy` when rate-limit/audit side effects are acceptable and
  the operator records that one failed-login privacy probe was run.

Needs explicit authorization:

- `smoke:auth-onboarding`, because it registers or reuses a test identity and
  initializes workspace state.
- E2B IDE, desktop, and Agent SDK workspace smoke tests, because they provision
  sandboxes and may consume model/provider resources.
- `landing-live`, because it includes live E2B and auth/onboarding smokes.
- Any `/api/chat` call.
- Any account registration, onboarding, cleanup of active sessions, or test-user
  reset.

Needs a release window:

- `npm run db:migrate`
- Backend restart or service config edits.
- Nginx config changes.
- Frontend or backend rollback.
- Credential rotation.

Never write real secrets into this file, shell history, PR comments, screenshots,
or chat. When inspecting env, redact `SECRET`, `TOKEN`, `PASSWORD`, `KEY`, and
`DATABASE_URL` values.

## Local Release Candidate Gate

Run from a clean worktree, not from the dirty coordinator workspace:

```bash
cd mycc-backend
npm run landing:classify -- --fail-on-unclassified
npm run verify:e2b-release
npm run harness:verify -- --target=landing --no-write
```

Expected for a fully credentialed release shell:

- Backend build passes.
- Frontend build passes.
- Backend Vitest passes.
- Focused product-facing frontend tests pass.
- Static agent evals pass.
- E2B release readiness passes.
- E2B Agent doctor is ready.
- Sandbox template doctor is ready.

If a local shell does not have E2B or Claude credentials, `e2b-agent` may fail
while the build, tests, static evals, release readiness, and sandbox template
checks still pass. Record that as credential-blocked, not product-passed.

## Production No-Side-Effect Gate

Run these before any production write, restart, registration, onboarding, or
E2B smoke:

```bash
curl -fsS -D - https://daoyou.iaigc.fun/health
curl -fsS -D - https://daoyou.iaigc.fun/readyz
curl -sS -D - https://daoyou.iaigc.fun/readyz/deep
curl -fsS -L https://daoyou.iaigc.fun/ -o /tmp/daoyou-home.html
rg -n "<title|description|道友|念头|MyCC|linuxUser|E2B|sandbox|traffic token|code-server" /tmp/daoyou-home.html
cd /home/armysheng/mycc/mycc-backend
BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface
```

Expected:

- `/health` returns `200`.
- `/readyz` returns `200` and `ready=true`.
- Public unauthenticated `/readyz/deep` returns `401` with only
  `{"error":"readyz_deep_unauthorized","status":"unauthorized"}`.
- Home HTML contains `道友 AI` and `念头通达`.
- Public HTML does not expose `MyCC`, `linuxUser`, E2B, sandbox, traffic token,
  or raw code-server details.
- `smoke:public-surface` prints `[ok] public surface smoke passed`.

Remote read-only state check:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
cd /home/armysheng/mycc
printf "head="
git rev-parse --short HEAD
printf "dirty_count="
git status --short | wc -l | tr -d " "
printf "\nservice="
systemctl --user is-active mycc-backend.service
'
```

Optional production doctor, no user creation:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
NODE_BIN_DIR=/home/armysheng/.local/node-v20.19.5-linux-x64/bin
export PATH="$NODE_BIN_DIR:$PATH"
cd /home/armysheng/mycc/mycc-backend
./scripts/guard-production-node.sh
npm run doctor:e2b-agent
'
```

The Node guard must show Node `v20.19.5` and the same `node`/`npm` binaries as
the user systemd backend service.

Ops-only deep readiness, no user creation:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
cd /home/armysheng/mycc/mycc-backend
set -a
. ./.env
set +a
curl -fsS -H "Authorization: Bearer ${MYCC_READYZ_DEEP_TOKEN}" \
  http://127.0.0.1:8080/readyz/deep
'
```

Expected:

- `ready=true`, `status=ok`.
- `checks.database.status=pass`.
- `checks.skills.status=pass`.
- `checks.runtime.status=pass` with E2B Agent preflight ready.
- `checks.ssh.status=skipped` when the configured runtime does not initialize SSH at startup.
- Do not paste the token or raw output containing sensitive fields into PRs, screenshots, or chat; record only the redacted status summary.

## Auth Privacy Smoke

This check is low risk but not completely invisible: it creates failed-login
audit/rate-limit events. Run it once per release candidate, not in a loop:

```bash
cd mycc-backend
BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy
```

Expected:

- Invalid login returns a generic credential error.
- The response does not reveal whether an account exists.
- No registration, onboarding, E2B session, or chat request is performed.

## Authorized Live Smoke Matrix

Only run after the release owner records the approval, test identity, expected
side effects, and cleanup expectation.

| Check | Command | Side effect | Cleanup expectation |
| --- | --- | --- | --- |
| Auth onboarding | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-onboarding` | Creates or reuses a test account and initializes workspace state | Record identity and reset only if requested |
| E2B IDE | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-ide` | Provisions an E2B code-server session | Script should clean temporary session |
| E2B desktop | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-desktop` | Provisions desktop/noVNC sandbox services | Script should clean temporary session |
| Agent SDK workspace | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-agent-sdk-workspace` | Uses Agent SDK runtime in an E2B workspace | Script should clean temporary sandbox/session |
| Full live gate | `BASE_URL=https://daoyou.iaigc.fun npm run harness:verify -- --target=landing-live --no-write` | Includes auth onboarding plus E2B smokes | Review generated report and cleanup output |

Notes:

- `smoke:auth-onboarding` does not call `/api/chat`, but it does register or
  reuse an account and calls `/api/onboarding/initialize`; depending on the
  target workspace provider and account initialization state, that initialize
  step may create or reuse workspace/E2B state.
- On targets where `GET /api/auth/config` reports `registration.mode=closed`,
  set an existing test identity before running the auth onboarding smoke or a
  `landing-live` gate that includes it:
  `MYCC_AUTH_SMOKE_CREDENTIAL=<email-or-phone>` and
  `MYCC_AUTH_SMOKE_PASSWORD=<password>`. `MYCC_AUTH_SMOKE_EMAIL` or
  `MYCC_AUTH_SMOKE_PHONE` can be used instead of
  `MYCC_AUTH_SMOKE_CREDENTIAL`.
- On invite-only targets, provide `MYCC_AUTH_SMOKE_INVITE_CODE` so the smoke
  can still create a new test account before initializing onboarding.
- `smoke:e2b-ide` may upsert the smoke user identified by
  `MYCC_SMOKE_USER_ID`, defaulting to `42`.
- `smoke:e2b-agent-sdk-workspace` writes marker files in the sandbox workspace
  while proving that Agent SDK and the workspace surface share the same state.

Do not run `/api/chat` manually as a substitute for the smoke scripts unless the
release owner explicitly authorizes model-consuming live validation.

## Guided Tester Script

Use this for the first 1-3 friendly testers. Each tester should record browser,
account identity, timestamp, PASS/FAIL/BLOCKED, screenshot or trace, and short
notes.

1. Open `https://daoyou.iaigc.fun`.
2. Confirm the first screen says `道友 AI` and `念头通达出品`.
3. Confirm no visible `MyCC`, `linuxUser`, E2B, sandbox, token, traffic token,
   raw noVNC URL, or code-server host appears.
4. Register or log in only with an assigned test identity.
5. Complete onboarding. The copy must not contain early internal nicknames such
   as `大辉哥`, `老板`, `主人`, or `cc`.
6. Confirm the user returns to the intended project, for example
   `/projects/demo`, after onboarding.
7. Open the assistant workspace surfaces and confirm the UI reads like a product
   assistant, not a provider dashboard.
8. If a model-consuming test is authorized, ask one small workspace task and
   verify that the output is useful, the workbench stays usable, and no provider
   internals leak.

Tester verdict:

- PASS: the flow completes and no P0/P1 leak or dead end appears.
- FAIL: production data exposure, login/onboarding dead end, E2B/raw provider
  leak, broken primary task, or unrecoverable frontend error.
- BLOCKED: provider/API quota, explicit release hold, or an external dependency
  outage prevents a fair result.

## Rollback

Rollback requires explicit approval unless production is actively unavailable.

### Frontend-only rollback

Known frontend backup:

```text
/home/armysheng/frontend-backups/daoyou-20260628T013011Z
```

Approval-gated rollback shape:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
rsync -a --delete /home/armysheng/frontend-backups/daoyou-20260628T013011Z/ /var/www/daoyou.iaigc.fun/
'
```

If the web root requires elevated permissions, the operator should use the
approved sudo path for that host. After rollback, re-run the no-side-effect gate.

### Backend config rollback

Config-first fallback:

```bash
MYCC_AGENT_RUNTIME=remote-claude
MYCC_IDE_PROVIDER=disabled
MYCC_WORKSPACE_PROVIDER=ssh
```

Then, inside the release window:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
cd /home/armysheng/mycc/mycc-backend
systemctl --user restart mycc-backend.service
npm run cleanup:ide-sessions
curl -fsS http://127.0.0.1:8080/health
'
```

Do not drop `ide_sessions` or `agent_runs` during emergency rollback. Keeping
the tables preserves audit and cleanup state.

### Source rollback

If the issue is a bad commit rather than config:

1. Confirm the previous known-good commit or release directory.
2. Confirm remote worktree state before changing it.
3. Build with the production Node `v20.19.5` toolchain.
4. Do not run migrations unless the migration gate is explicitly open.
5. Restart user systemd only inside the release window.
6. Re-run the production no-side-effect gate.

## Ship Decision

Guided internal test is acceptable when:

- Local `landing` gate passes or is credential-blocked only in a documented
  no-secret local shell.
- Production no-side-effect gate passes.
- `doctor:e2b-agent` passes in the production environment.
- Product surface audit finds no P0/P1 provider leak.
- Rollback path and owner are known.

Open public traffic only when:

- `landing-live` passes against `https://daoyou.iaigc.fun`.
- A friendly tester completes a real assistant task through chat, files,
  workbench, and at least one relevant skill flow.
- E2B sessions created by smoke or tester flows are cleaned up or intentionally
  retained.
- The release owner can point to the latest gate evidence and rollback notes.

## Evidence Template

```text
Date/time:
Operator:
Target commit:
Domain:
Gate:
Commands:
Result: PASS / FAIL / BLOCKED
Side effects:
Cleanup:
Evidence links or screenshots:
Notes:
```
