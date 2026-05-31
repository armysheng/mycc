# MyCC Assistant Sandbox

This module owns the user image for the MyCC personal assistant sandbox. It is intentionally separate from `mycc-backend`: the sandbox module defines what exists inside the Linux environment, while the backend creates sandboxes, injects runtime env, starts services, and proxies traffic.

MyCC API/frontend integration notes live in `../docs/mycc-assistant-sandbox-integration.md`.

## Template

Default E2B template name:

```text
mycc-assistant-sandbox-dev
```

The image is based on the Playwright Python noble image so the sandbox has Python 3.12, browser dependencies, and a browser automation baseline. The image adds:

- code-server
- Claude Code
- Claude Agent SDK bridge
- `ccr-router` CLI
- Node.js 22, npm, corepack
- Python venv, pip, uv, browser-use, Playwright
- GNU/native toolchain: git, rg, jq, gcc, g++, make, file, lsof, tree
- GNU desktop: Xvfb, XFCE, x11vnc, noVNC, websockify
- MyCC service scripts for code-server, CCR, desktop, and desktop health

The image also exposes `uv` through `/usr/local/bin/uv` and links `/home/mycc/.cache/ms-playwright` to `/ms-playwright`. E2B command execution does not preserve every Docker `ENV` value, so these symlinks keep Python/Playwright tooling usable for agents without extra environment injection.

## Build/Create

Authenticate E2B CLI without printing credentials, then create the template:

```bash
cd mycc-sandbox
npm install
npm run doctor:template
npm run template:create
npm run smoke:e2b-template
```

Useful overrides:

```bash
MYCC_SANDBOX_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_SANDBOX_TEMPLATE_CPU_COUNT=4
MYCC_SANDBOX_TEMPLATE_MEMORY_MB=8192
```

## Runtime Services

The backend should create one sandbox per user workspace, then start services on demand:

```bash
mycc-start-code-server
mycc-start-ccr
mycc-start-desktop
mycc-health-desktop
mycc-register-deliverable
```

Default local service ports:

- code-server: `127.0.0.1:18080`
- CCR: `127.0.0.1:13456`
- VNC: `127.0.0.1:15900`
- noVNC: `127.0.0.1:16080`

## Deliverable Registry

Agents should register user-facing outputs with the built-in helper instead of editing registry JSON by hand:

```bash
mycc-register-deliverable \
  --path /reports/summary.md \
  --title "Project summary" \
  --kind report \
  --description "Current project status and next steps"
```

The helper writes `.mycc/deliverables.json`, deduplicates by workspace path, and rejects hidden paths or secret-looking titles, descriptions, and filenames. MyCC reads this registry to populate the product "成果" surfaces.

The browser must receive only MyCC proxy URLs. Do not return raw E2B hosts, E2B traffic tokens, provider base URLs, provider tokens, or noVNC credentials to the browser.

## MyCC Backend Integration

For local MyCC joint debugging, do not edit or print real credential values in docs or logs. Set only the non-secret shape below in `mycc-backend/.env`, with real secret values supplied privately:

```bash
MYCC_IDE_PROVIDER=e2b
MYCC_WORKSPACE_PROVIDER=e2b
MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev
MYCC_E2B_DESKTOP_ENABLED=true
MYCC_E2B_DESKTOP_PORT=16080
MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false
```

Apply the backend desktop compatibility migration before opening the Workbench:

```bash
mycc-backend/db/migrations/004-add-ide-desktop-service.sql
```

The first frontend slice opens code-server and the GNU desktop in new tabs through `/api/ide` MyCC proxy routes. A later migration can split `ide_sessions` into `sandbox_sessions` and `sandbox_services`, but this template is already structured as one sandbox with multiple services.

## CCR Env Injection

`mycc-start-ccr` writes a config with environment references, not literal secrets. MyCC should inject values into the CCR process environment, for example:

```text
MYCC_PROVIDER_BASE_URL
MYCC_PROVIDER_API_KEY
MYCC_CCR_AUTH_TOKEN
MYCC_CCR_MODEL
```

Those values must not be logged or returned to the browser.

## Smoke Checks

Local contract and secret-shape checks:

```bash
npm test
npm run smoke:local-contract
```

Real E2B template smoke:

```bash
npm run smoke:e2b-template
```

The E2B smoke creates a temporary private sandbox, runs the full template contract, starts code-server, starts GNU desktop/noVNC, launches a headless Playwright browser, and then destroys the sandbox. It intentionally does not call `getHost`, print raw E2B hosts, or print traffic/provider tokens.
