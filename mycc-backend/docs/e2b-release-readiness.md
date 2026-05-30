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
- E2B template name: `MYCC_E2B_TEMPLATE=mycc-code-server-dev` unless releasing a versioned template.
- Database migration applied: `db/migrations/003-add-ide-sessions.sql`.

Do not configure global `OPENAI_BASE_URL` or `OPENAI_API_KEY` in the MyCC backend process for this path. Put OpenAI-compatible upstream credentials inside the CCR router process instead.

## Template Release

1. Update template dependencies in `templates/e2b-code-server/e2b.Dockerfile`.
2. Keep `templates/e2b-code-server/template.ts`, `scripts/create-e2b-code-server-template.sh`, and `templates/e2b-code-server/README.md` ready commands aligned.
3. Build or update the E2B template from `mycc-backend`:

```bash
npm run template:e2b-code-server:create
```

4. Record the template name, runtime package versions, build time, and E2B account in the release notes.
5. Run `npm run doctor:e2b-agent` against the same backend `.env` that will run smoke tests.

## Database Gate

Before enabling E2B in a long-lived environment:

```bash
psql "$DATABASE_URL" -f db/migrations/003-add-ide-sessions.sql
psql "$DATABASE_URL" -c "select to_regclass('public.ide_sessions') as ide_sessions;"
```

Expected result: `ide_sessions` resolves to `ide_sessions`.

## Local Verification Gate

Run these from `mycc-backend` before pushing a release branch:

```bash
npm run verify:e2b-release
npm test -- --run
npm run build
npm run doctor:e2b-agent
```

The first command is a static release-readiness guard. The doctor command may query E2B when a valid API key is configured, but it must not print secrets.

## Runtime Smoke Gate

Start the backend with the target `.env`, then run:

```bash
BASE_URL=http://localhost:18081 npm run smoke:e2b-ide
BASE_URL=http://localhost:18081 npm run smoke:e2b-agent-sdk-workspace
```

Required behavior:

- `smoke:e2b-ide` creates an E2B code-server session, proves the raw E2B host rejects unauthenticated traffic, proves MyCC proxy access works, and cleans up the session.
- `smoke:e2b-agent-sdk-workspace` proves Agent SDK and code-server share the same workspace, validates the template contract, verifies GNU/native tooling, and cleans up the sandbox.

## Production Enablement

Set these values only after all gates pass:

```bash
MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-code-server-dev
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep
MYCC_AGENT_SDK_PERMISSION_MODE=dontAsk
```

Keep write-capable smoke defaults such as `Write,Edit,MultiEdit,Bash` out of product defaults unless a separate product review explicitly approves them.

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
