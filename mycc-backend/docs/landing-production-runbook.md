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
- Current deployed commit: verify live on the host before a release decision with
  `cd /home/armysheng/mycc && git rev-parse --short HEAD`; do not hard-code it
  as current in this runbook because docs-only maintenance deploys can change it.
- Latest recorded no-side-effect production state checked on 2026-06-29 CST:
  - Remote worktree dirty count: `0`
  - `systemctl --user is-active mycc-backend.service`: `active`
  - `GET /health`: `200`
  - `GET /readyz`: `200`, `ready=true`
  - Unauthenticated `GET /readyz/deep`: `401`, `readyz_deep_unauthorized`
  - Authorized local `GET /readyz/deep` with `MYCC_READYZ_DEEP_TOKEN`: `ready=true`, `database=pass`, `skills=pass`, `runtime=pass`, `ssh=skipped`
  - Production `schema_migrations`: 8 applied migrations; `007-add-agent-run-trace.sql` and `008-add-ide-session-identity.sql` are applied; OAuth release candidates must also apply `009-add-oauth-accounts.sql` before enabling callbacks
  - `GET /api/auth/config`: `registration.mode=closed`, `enabled=false`
  - `GET /favicon.svg`: `200`, `content-type=image/svg+xml`
  - `BASE_URL=https://daoyou.iaigc.fun npm run smoke:public-surface`: passed
  - `MYCC_ONBOARDING_ASYNC`: `false_or_unset`
  - Home HTML title: `道友 AI`
  - Home meta description includes `念头通达`
  - GitHub `CI` run `28373993080` passed for `82d2fec`: `frontend-ci`, `backend-ci`, and `sandbox-ci`
  - GitHub `Deploy Staging` run `28374057187` passed for `82d2fec`
  - Production Node guard: Node `v20.19.5`, matching systemd service toolchain
  - `npm run doctor:e2b-agent`: E2B Agent preflight ready
  - `npm --prefix mycc-sandbox run doctor:template`: credentials present and template `mycc-assistant-sandbox-dev` exists
  - Playwright product-surface audit: desktop login, 390x844 mobile login, and registration closed state passed without forbidden public text or mobile horizontal overflow
  - Latest no-side-effect maintenance through PR #121 has `prod_dirty_count=0`, backend service `active`, public-surface smoke passed, and production `doctor:e2b-agent` reports E2B Agent preflight ready

Historical low-side-effect evidence:

- `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-privacy`: passed on deployed commit `23074b0`; one failed-login privacy probe was run. Re-run at most once per release candidate and record the audit/rate-limit side effect.

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
- Google/GitHub OAuth live callback smoke, because it uses a third-party
  provider identity and may create or link a production account. Provider apps,
  secrets, callback domains, migration `009-add-oauth-accounts.sql`, test
  identity, side effects, and cleanup owner must be recorded first.
- E2B IDE, desktop, and Agent SDK workspace smoke tests, because they provision
  sandboxes and may consume model/provider resources.
- `landing-live`, because it includes live E2B and auth/onboarding smokes.
- Any `/api/chat` call.
- `smoke:local-chat-flow` or any other model-consuming smoke against
  `https://daoyou.iaigc.fun`.
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
npm run verify:rollback-preflight
npm run verify:e2b-release
npm run harness:verify -- --target=landing --no-write
```

Also review the classifier summary before staging release files. The release
branch should have no unexpected `needs-owner-review` or `do-not-stage` entries.

Expected for a fully credentialed release shell:

- Backend build passes.
- Frontend build passes.
- Backend Vitest passes.
- Focused product-facing frontend tests pass.
- Static agent evals pass.
- Rollback preflight passes.
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

Read-only migration evidence:

```bash
ssh armysheng@136.110.125.242 'set -euo pipefail
cd /home/armysheng/mycc/mycc-backend
set -a
. ./.env
set +a
node - <<'"'"'NODE'"'"'
const pg = require("pg");
const required = [
  "007-add-agent-run-trace.sql",
  "008-add-ide-session-identity.sql",
  "009-add-oauth-accounts.sql",
];
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename");
    const applied = new Set(result.rows.map((row) => row.filename));
    console.log(JSON.stringify({
      migration_count: result.rows.length,
      required: Object.fromEntries(required.map((name) => [name, applied.has(name) ? "applied" : "missing"])),
    }, null, 2));
  } finally {
    await pool.end();
  }
})();
NODE
'
```

Expected for non-OAuth landing releases: `migration_count` includes all repo migrations through `008`, and required landing migrations `007`/`008` report `applied`. Expected for PR #124 / OAuth releases: `009-add-oauth-accounts.sql` also reports `applied` before live callback smoke. This command is read-only and must not be replaced with `npm run db:migrate` unless the migration gate is explicitly open.

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

## Live Gate Release Decision Packet

Use this packet before running any command in the live smoke matrix. Do not
replace it with an informal chat approval because the live checks create durable
production evidence and may allocate E2B/model resources.

```text
Release gate id:
Release owner:
Operator:
Target URL: https://daoyou.iaigc.fun
Target deployed commit: <verified deployed commit from git rev-parse on the host>
Approval timestamp:
Release window:
Evidence path:
Approved checks:
  [ ] OAuth provider app/secrets and callback domains verified
  [ ] migration 009-add-oauth-accounts.sql applied when OAuth is in scope
  [ ] Google/GitHub live callback smoke
  [ ] smoke:auth-onboarding
  [ ] smoke:e2b-ide
  [ ] smoke:e2b-desktop
  [ ] smoke:e2b-agent-sdk-workspace
  [ ] harness:verify -- --target=landing-live --no-write
  [ ] rollback rehearsal
Test identity source: existing / invite / newly created
Test identity label, not secret:
Expected side effects:
  [ ] failed login audit/rate-limit event already accepted
  [ ] auth/onboarding writes
  [ ] E2B smoke user DB upsert and users id sequence touch
  [ ] E2B IDE session
  [ ] E2B desktop service
  [ ] Agent SDK workspace marker files
  [ ] backend restart during rollback rehearsal
Cleanup expectation:
Cleanup owner:
Cleanup deadline:
Abort threshold:
Evidence owner:
Rollback owner:
```

Run order once approved:

1. Re-run the production no-side-effect gate and confirm the remote worktree is
   clean before any live smoke.
2. Run `smoke:auth-onboarding` with the approved test identity.
3. Run E2B IDE, desktop, and Agent SDK workspace smokes one at a time; record
   the command, timestamp, PASS/FAIL/BLOCKED, and cleanup output after each.
4. Run `landing-live` only if the individual auth and E2B smokes pass or the
   release owner explicitly accepts a known non-product blocker.
5. Run rollback rehearsal in the release window, then restore the landing
   runtime config and re-run `/health`, `/readyz`, and `smoke:public-surface`.
6. Update `landing-readiness.md` with the final decision and any cleanup notes.

Abort immediately and do not continue to later live checks if any of these
appear:

- Provider or raw infrastructure details reach the public UI or API response.
- `/health`, `/readyz`, or protected deep readiness becomes unavailable.
- A smoke cannot confirm cleanup of its E2B session or service.
- The approved test identity cannot be identified in the evidence log.
- Any command needs a real user secret pasted into terminal history, PRs,
  screenshots, or chat.

## Authorized Live Smoke Matrix

Only run after the release owner records the approval, test identity, expected
side effects, and cleanup expectation.

| Check | Command | Side effect | Cleanup expectation |
| --- | --- | --- | --- |
| Auth onboarding | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:auth-onboarding` | Creates or reuses a test account and initializes workspace state | Record identity and reset only if requested |
| E2B IDE | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-ide` | Provisions an E2B code-server session | Script should clean temporary session |
| E2B desktop | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-desktop` | Provisions desktop/noVNC sandbox services | Script should clean temporary session |
| Agent SDK workspace | `BASE_URL=https://daoyou.iaigc.fun npm run smoke:e2b-agent-sdk-workspace` | Uses Agent SDK runtime in an E2B workspace | Script should clean temporary sandbox/session |
| Full live gate | `MYCC_LIVE_GATE_APPROVED=1 BASE_URL=https://daoyou.iaigc.fun npm run harness:verify -- --target=landing-live --no-write` | Includes auth onboarding plus E2B smokes | Review generated report and cleanup output |

Notes:

- `--no-write` only means the harness does not write JSON/Markdown report files.
  It does not make `landing-live` read-only, and the operator must still save a
  redacted evidence record at the approved evidence path.
- `MYCC_LIVE_GATE_APPROVED=1` is a deliberate operator acknowledgement. The
  harness refuses live side-effect targets without it and without an explicit
  `BASE_URL`.
- When the expanded harness target includes live side-effect checks, the harness
  runs in fail-fast mode: after the first failed target, later targets are marked
  `skipped` so failed prerequisites do not cascade into account or E2B side
  effects. Each child command also has a bounded runtime.
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
  `MYCC_SMOKE_USER_ID`, defaulting to `42`; this can also advance the users
  sequence through the smoke setup query.
- `smoke:e2b-agent-sdk-workspace` writes marker files in the sandbox workspace
  while proving that Agent SDK and the workspace surface share the same state.
- E2B smoke evidence may include product session ids or a redacted
  `sandboxRef`. Record those redacted references only; never paste raw E2B
  sandbox ids, hosts, traffic tokens, provider tokens, or noVNC/code-server
  direct URLs into PRs, screenshots, chat, or this runbook.
- E2B smoke scripts always attempt cleanup. If both the smoke body and cleanup
  fail, the original smoke failure remains the command failure and the cleanup
  failure is printed separately as `[cleanup:error]`.

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
Redacted runtime refs:
Evidence links or screenshots:
Notes:
```
