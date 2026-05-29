# E2B code-server Template

This template builds the `mycc-code-server-dev` sandbox image used by the Remote IDE POC.

It installs:

- GNU/Linux userland tools: `bash`, `git`, `ripgrep`, `jq`, `build-essential`, `python3`
- Node.js 22 and npm
- `code-server`
- `@anthropic-ai/claude-code`
- `@anthropic-ai/claude-agent-sdk` in `/opt/mycc-agent-runtime`

The default sandbox user is `mycc` and the default workspace is `/home/mycc/workspace`.

## Build

Run this manually; do not wire it into the normal backend build.

```bash
cd mycc-backend/templates/e2b-code-server
e2b template create mycc-code-server-dev \
  --path . \
  --dockerfile e2b.Dockerfile \
  --ready-cmd "code-server --version && node --version && npm --version && claude --version && rg --version && git --version && python3 --version && gcc --version"
```

If the template already exists, use the equivalent E2B CLI update/build flow for your account.

## Runtime Contract

The backend starts `code-server` dynamically; this template should not start it as a default command.

Expected runtime command shape:

```bash
code-server \
  --bind-addr 0.0.0.0:18080 \
  --auth none \
  --disable-telemetry \
  --disable-update-check \
  --idle-timeout-seconds 1800 \
  --user-data-dir /home/mycc/.local/share/code-server \
  --extensions-dir /home/mycc/.local/share/code-server/extensions \
  /home/mycc/workspace
```

`--auth none` is only acceptable because product traffic must go through mycc's authenticated reverse proxy with E2B `allowPublicTraffic:false`. Do not expose the raw E2B host to users.

## Smoke Checks

After creating a sandbox from `mycc-code-server-dev`, run:

```bash
code-server --version
node --version
npm --version
claude --version
rg --version
git --version
python3 --version
gcc --version
pwd
whoami
```

Expected:

- `whoami` prints `mycc`
- `pwd` prints `/home/mycc/workspace`
- All version commands succeed
