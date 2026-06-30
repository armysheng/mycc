# E2B Release Readiness

This checklist is for enabling the product path:

- `MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk`
- `MYCC_IDE_PROVIDER=e2b`
- `MYCC_WORKSPACE_PROVIDER=e2b`
- `MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false`

Keep this path opt-in until the release owner has run every gate below.

## Required Inputs

- E2B API key in the backend environment: `MYCC_E2B_API_KEY=e2b_<token>` or `E2B_API_KEY=e2b_<token>`.
- E2B CLI auth for template builds: `E2B_ACCESS_TOKEN` or `npx --yes @e2b/cli auth login`.
- Claude/CCR credentials: prefer `MYCC_CCR_BASE_URL` plus `MYCC_CCR_AUTH_TOKEN`.
- E2B template name: `MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev` unless releasing a versioned template.
- Database migrations applied through `npm run db:migrate`, including `db/migrations/003-add-ide-sessions.sql`, `db/migrations/004-add-ide-desktop-service.sql`, `db/migrations/008-add-ide-session-identity.sql`, and `db/migrations/007-add-agent-run-trace.sql`. If the release candidate includes OAuth login, also apply `db/migrations/009-add-oauth-accounts.sql` before Google/GitHub callback smoke.

Do not configure global `OPENAI_BASE_URL` or `OPENAI_API_KEY` in the MyCC backend process for this path. Put OpenAI-compatible upstream credentials inside the CCR router process instead.

## Template Release

1. Update template dependencies in `../mycc-sandbox/templates/e2b-assistant-sandbox/e2b.Dockerfile`.
2. Keep the assistant sandbox contract, doctor, and smoke scripts in `../mycc-sandbox` aligned.
3. Build or update the E2B template from `mycc-sandbox`:

```bash
npm install
npm run doctor:template
npm run smoke:e2b-template
```

4. Record the template name, runtime package versions, build time, and E2B account in the release notes.
5. Run `npm run doctor:e2b-agent` against the same backend `.env` that will run smoke tests.

## Database Gate

Before enabling E2B in a long-lived environment:

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "select to_regclass('public.ide_sessions') as ide_sessions, to_regclass('public.agent_runs') as agent_runs;"
```

Expected result: `ide_sessions` and `agent_runs` resolve to table names.
For OAuth release candidates, also verify the OAuth accounts table created by `009-add-oauth-accounts.sql` exists before enabling provider callbacks.

## Local Verification Gate

Run these from `mycc-backend` before pushing a release branch:

```bash
npm run landing:classify -- --fail-on-unclassified
npm run harness:verify -- --target=landing --no-write
npm run verify:rollback-preflight
npm run verify:e2b-release
npm test -- --run
npm run build
npm run doctor:e2b-agent
```

The first command is a static release-readiness guard. The doctor command may query E2B when a valid API key is configured, but it must not print secrets.

## Runtime Smoke Gate

Start the backend with the target `.env`, then run:

```bash
MYCC_LIVE_GATE_APPROVED=1 BASE_URL=http://localhost:18081 npm run harness:verify -- --target=landing-live --no-write
BASE_URL=http://localhost:18081 npm run smoke:e2b-ide
BASE_URL=http://localhost:18081 npm run smoke:e2b-desktop
BASE_URL=http://localhost:18081 npm run smoke:e2b-agent-sdk-workspace
```

Required behavior:

- `smoke:e2b-ide` creates an E2B code-server session from the assistant sandbox, proves the raw E2B host rejects unauthenticated traffic, proves MyCC proxy access works, and cleans up the session.
- `smoke:e2b-desktop` proves the desktop/noVNC service also stays behind the MyCC proxy and does not leak provider routing data.
- `smoke:e2b-agent-sdk-workspace` proves Agent SDK and code-server share the same workspace, validates the template contract, verifies GNU/native tooling, and cleans up the sandbox.

## Production Enablement

Set these values only after all gates pass:

```bash
MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_DESKTOP_PORT=16080
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep,Bash,Edit,Write
MYCC_AGENT_SDK_PERMISSION_MODE=bypassPermissions
MYCC_AGENT_RUN_STORE=postgres
```

The product default allows normal workspace work with `Read,Glob,Grep,Bash,Edit,Write` and `bypassPermissions`. System protection belongs in MyCC hooks, cwd validation, sandbox policy, and release smoke checks, not repeated user confirmations.

## Rollback

Rollback is config-first:

```bash
MYCC_AGENT_RUNTIME=remote-claude
MYCC_IDE_PROVIDER=disabled
MYCC_WORKSPACE_PROVIDER=ssh
```

Then restart the backend and run:

```bash
npm run cleanup:ide-sessions
curl -fsS http://localhost:8080/health
```

The `ide_sessions` table may remain in the database after rollback. Do not drop it during emergency rollback; keeping it preserves audit history and avoids losing cleanup state.

If the rollback reason is a bad E2B template, keep the old working template name available and switch `MYCC_E2B_TEMPLATE` back to that name before re-enabling the E2B path.
