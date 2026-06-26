# P1 hotfix: auth and readiness rollout

Date: 2026-06-26

This runbook covers only the backend auth/readiness hotfix on branch
`codex/p1-auth-readiness-hotfix`. It is written for staging verification,
predeploy review, production rollout, post-deploy checks, and rollback.

## Scope

This hotfix is backend-only and should be deployed as the minimal backend
artifact/branch prepared from this branch.

Runtime files in scope:

- `mycc-backend/src/auth/service.ts`
- `mycc-backend/src/routes/auth.ts`
- `mycc-backend/src/middleware/jwt.ts`
- `mycc-backend/src/auth/rate-limit.ts`
- `mycc-backend/src/routes/readiness.ts`
- `mycc-backend/src/startup/readiness.ts`
- `mycc-backend/src/index.ts`

Focused tests in scope:

- `mycc-backend/src/auth/service.test.ts`
- `mycc-backend/src/routes/auth.test.ts`
- `mycc-backend/src/middleware/jwt.test.ts`
- `mycc-backend/src/startup/readiness.test.ts`
- `mycc-backend/src/routes/readiness.test.ts`

## Explicit exclude list

Do not include, stage, build into the hotfix artifact, or deploy any of the
following as part of this hotfix:

- Frontend changes or frontend build artifacts.
- Sandbox changes, sandbox runtime files, or sandbox smoke outputs.
- Skills changes or generated skill artifacts.
- Large agent-runtime, IDE, chat, or workspace behavior changes.
- Database migrations `007` or `008`.
- `mycc-backend/db/schema.sql` or any schema dump.
- Any database migration output, seed output, local database files, or SQL
  scratch files.
- Do-not-stage artifacts such as logs, screenshots, coverage output, temporary
  reports, local env files, generated bundles outside the backend artifact, or
  one-off verification captures.

## No migration statement

This hotfix does not run database migrations.

The production rollout must not ship or apply migrations `007` or `008`, must
not ship `mycc-backend/db/schema.sql`, and must not run schema synchronization
commands. If the deployment process tries to include migration or schema files,
stop and rebuild the backend-only hotfix artifact.

## Configuration

Production must use a non-placeholder `JWT_SECRET`. The startup guard rejects
the development placeholder in production.

Admin authorization is derived from server-side allowlists, not from legacy JWT
role claims:

- `MYCC_ADMIN_USER_IDS`
- `MYCC_ADMIN_EMAILS`
- `MYCC_ADMIN_PHONES`

Deep readiness is operations-only and requires `MYCC_READYZ_DEEP_TOKEN`.
Configure the value through the production secret manager or host environment.
Do not write the real value in this runbook, shell history, chat, PR text, issue
comments, screenshots, or logs.

`/readyz/deep` accepts either an authorization bearer token or the
`x-mycc-readyz-deep-token` header. Unauthenticated requests return only:

```json
{ "error": "readyz_deep_unauthorized", "status": "unauthorized" }
```

The unauthenticated response must not expose readiness internals such as checks,
runtime details, E2B status, dependency names, or stack traces.

## Staging verification

Run these commands from the repository root before any deployment action:

```bash
npm -C mycc-backend test -- --run src/auth/service.test.ts src/routes/auth.test.ts src/middleware/jwt.test.ts src/startup/readiness.test.ts src/routes/readiness.test.ts
npm -C mycc-backend run build
git diff --check
git diff --name-only
```

The `git diff --name-only` output must match the backend hotfix scope and must
not include excluded files, migrations, schema dumps, frontend files, sandbox
files, skills files, or do-not-stage artifacts.

Optional local inspection commands:

```bash
git diff -- mycc-backend/src/auth/service.ts mycc-backend/src/routes/auth.ts mycc-backend/src/middleware/jwt.ts mycc-backend/src/auth/rate-limit.ts mycc-backend/src/routes/readiness.ts mycc-backend/src/startup/readiness.ts mycc-backend/src/index.ts
git diff -- mycc-backend/src/auth/service.test.ts mycc-backend/src/routes/auth.test.ts mycc-backend/src/middleware/jwt.test.ts mycc-backend/src/startup/readiness.test.ts mycc-backend/src/routes/readiness.test.ts
```

## Predeploy read-only checks

Remote predeploy checks must be read-only. Do not restart services, modify
files, run migrations, register users, start onboarding, call E2B, or call
`/api/chat` during predeploy verification.

Use placeholders for host, service, and paths:

```bash
ssh <prod-host> 'pwd'
ssh <prod-host> 'ls -ld <project-dir>'
ssh <prod-host> 'systemctl status <backend-service> --no-pager'
ssh <prod-host> 'systemctl show <backend-service> -p FragmentPath -p DropInPaths -p User -p WorkingDirectory -p ExecStart --no-pager | sed -E "s/(SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL)=([^[:space:]]+)/\1=REDACTED/g"'
ssh <prod-host> 'nginx -T 2>/dev/null | sed -E "s/(secret|token|password|key)[^;]*/REDACTED/Ig" | sed -n "/server_name <domain>/,/}/p"'
ssh <prod-host> 'printenv | grep -E "^(NODE_ENV|PORT|MYCC_|JWT_|DATABASE_URL)" | sed -E "s/(SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL).*/REDACTED/"'
```

The environment check is for key presence and wiring only. It must redact
values and must not print secrets.

## Production rollout placeholders

Deploy only the backend hotfix artifact or the backend branch content from
`codex/p1-auth-readiness-hotfix`. Do not deploy the full dirty working tree.

Placeholder sequence:

```bash
# Build or fetch the backend-only hotfix artifact from codex/p1-auth-readiness-hotfix.
# Upload or checkout only the backend hotfix content on <prod-host>.
# Configure JWT_SECRET and MYCC_READYZ_DEEP_TOKEN via the approved secret path.
# Verify excluded files are absent from the artifact before restarting.
# Restart only the backend service.
# Watch service logs for startup failure without printing secret values.
```

Before restart, confirm that the deployed artifact does not contain frontend,
sandbox, skills, migrations `007` or `008`, `mycc-backend/db/schema.sql`, or
do-not-stage artifacts. If any excluded item is present, abort rollout.

## Post-deploy no-side-effect checks

These checks are allowed because they do not create users, start onboarding,
provision E2B, or call chat:

```bash
curl -fsS https://<domain>/health
curl -fsS https://<domain>/readyz
curl -i -sS https://<domain>/readyz/deep
```

Expected results:

- `/health` returns a healthy response.
- `/readyz` returns the public readiness response.
- Unauthenticated `/readyz/deep` returns HTTP 401 with
  `readyz_deep_unauthorized`.
- Unauthenticated `/readyz/deep` must not contain `checks`, `runtime`, `E2B`,
  dependency internals, or stack traces.

Auth privacy check:

- Use a credential-style login payload with a deliberately invalid credential
  and invalid password.
- The response must not say `用户不存在` and must not reveal whether the
  credential maps to a real account.
- This check only causes failed-login audit logs and rate-limit counters. Do
  not run it repeatedly; one controlled request is enough.

## Forbidden side-effect checks

The following are forbidden unless the operator explicitly authorizes them for
this production window:

- Registration.
- Onboarding.
- E2B provisioning, E2B readiness smoke, or E2B runtime checks.
- `/api/chat` calls.
- Any check that creates users, workspaces, sessions, sandboxes, billing events,
  chat messages, or background jobs.

If explicit authorization is granted later, record who authorized it, what exact
command or endpoint is allowed, and the expected cleanup path before running it.

## Rollback plan

Rollback is service-only and migration-free:

1. Keep the previous backend artifact, branch, or release directory available
   before deploying the hotfix.
2. If startup fails, readiness fails, auth regressions appear, or excluded files
   are discovered in the deployed artifact, switch the backend service back to
   the previous known-good artifact/branch.
3. Restart only the backend service.
4. Re-run `/health`, `/readyz`, and unauthenticated `/readyz/deep` checks.
5. Confirm logs no longer show the hotfix failure mode. Redact secrets when
   sharing logs.
6. Do not run rollback migrations; this hotfix has no schema change to undo.
7. Preserve the failed hotfix artifact and logs for investigation, but do not
   stage generated logs or local artifacts into the repository.
