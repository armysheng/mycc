# MyCC Assistant Sandbox Joint Debug Checklist

This checklist verifies the MyCC personal assistant sandbox path without exposing raw E2B hosts, traffic tokens, provider base URLs, or provider tokens.

For the full API/frontend integration contract and built-in skill list, see `../mycc-assistant-sandbox-integration.md`.

## 1. Template

Use the independent sandbox module:

```bash
cd mycc-sandbox
npm install
npm run doctor:template
npm run smoke:e2b-template
```

Expected:

- `doctor:template` reports the `mycc-assistant-sandbox-dev` template exists.
- `smoke:e2b-template` passes full contract, code-server health, desktop/noVNC health, Playwright/Chromium automation, and cleanup.

## 2. Backend Config

Set the MyCC backend to use the assistant sandbox template. Keep real values private.

```bash
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_DESKTOP_PORT=16080
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
```

Also provide a valid E2B API key through `MYCC_E2B_API_KEY` or `E2B_API_KEY`. Do not print the value.

## 3. Database

Apply the desktop compatibility migration:

```text
mycc-backend/db/migrations/004-add-ide-desktop-service.sql
```

Expected columns on `ide_sessions`:

- `desktop_pid`
- `desktop_host`
- `desktop_port`

## 4. Backend Verification

```bash
cd mycc-backend
npm run doctor:e2b-agent
npm test -- --run src/ide/service.test.ts src/ide/e2b-provider.test.ts src/ide/session-store.test.ts src/routes/ide.test.ts
```

Expected:

- Doctor reports credential presence without printing values.
- Route/provider/store tests pass.
- Public API responses do not include provider host or traffic token fields.

With the backend server running, run the MyCC API desktop smoke:

```bash
cd mycc-backend
npm run smoke:e2b-desktop
```

Expected:

- The script creates a code-server session, starts the desktop service in the same sandbox, opens noVNC through the MyCC proxy, verifies direct E2B desktop host access is rejected, and cleans up the session.

## 5. Frontend Verification

```bash
cd mycc-web-react
npm run test:run -- src/components/WorkspacePage.test.tsx
```

Expected:

- Workbench shows user-facing copy only.
- "打开代码编辑器" opens a MyCC proxy URL.
- "打开桌面工作间" starts the desktop service and opens a MyCC proxy URL.

## 6. Manual Joint Debug Flow

1. Start MyCC backend and web normally.
2. Log in as a test user.
3. Open Workbench.
4. Click "打开代码编辑器".
5. Confirm code-server opens in a new tab through `/api/ide/sessions/.../open`.
6. Return to Workbench and click "打开桌面工作间".
7. Confirm noVNC opens in a new tab through `/api/ide/sessions/.../desktop/open`.
8. Confirm files created by agent/code-server/desktop appear under the same `/home/mycc/workspace`.

Browser-visible URLs must stay under the MyCC origin. Raw E2B hosts, E2B traffic tokens, provider base URLs, and provider tokens must not appear in page text, API JSON, console logs, or copied URLs.
