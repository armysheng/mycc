# E2B code-server Template

This template builds the `mycc-code-server-dev` sandbox image used by the Remote IDE POC.

It installs:

- GNU/Linux userland and build tools: `bash`, `coreutils`, `findutils`, `grep`, `sed`, `gawk`, `tar`, `gzip`, `git`, `openssh-client`, `ripgrep`, `jq`, `build-essential`, `make`, `pkg-config`, `python3`, `python3-venv`, `lsof`, `net-tools`, `file`, `tree`, `less`, `vim`, `nano`, `zip`, `unzip`
- Node.js 22 and npm
- `code-server`
- `@anthropic-ai/claude-code`
- `@anthropic-ai/claude-agent-sdk` and the mycc Agent SDK bridge in `/opt/mycc-agent-runtime`

The default sandbox user is `mycc` and the default workspace is `/home/mycc/workspace`.

## Build

Run this manually; do not wire it into the normal backend build.

```bash
cd mycc-backend/templates/e2b-code-server
e2b template create mycc-code-server-dev \
  --path . \
  --dockerfile e2b.Dockerfile \
  --ready-cmd "code-server --version && node --version && npm --version && claude --version && rg --version && git --version && python3 --version && gcc --version && make --version && find --version && gawk --version && lsof -v && tree --version"
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

The E2B Agent SDK runtime expects the bridge command below by default:

```bash
cd /opt/mycc-agent-runtime && node bridge.mjs
```

The backend passes prompt/session/workspace details through environment variables:

- `MYCC_AGENT_PROMPT_B64`
- `MYCC_AGENT_WORKSPACE_CWD=/home/mycc/workspace`
- `MYCC_AGENT_SESSION_ID` when resuming
- `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_API_KEY`
- `CLAUDE_CONFIG_DIR=/home/mycc/.mycc/claude`
- `HOME=/home/mycc/.mycc/home`

The product default allowed tools are read-only. The SDK workspace smoke script sets write-capable smoke defaults locally (`Read,Glob,Grep,Write,Edit,MultiEdit,Bash` with `bypassPermissions`) unless you override `MYCC_AGENT_SDK_ALLOWED_TOOLS` / `MYCC_AGENT_SDK_PERMISSION_MODE`.

## Smoke Checks

After creating a sandbox from `mycc-code-server-dev`, run:

```bash
code-server --version
node --version
npm --version
claude --version
cd /opt/mycc-agent-runtime && node -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('agent-sdk ok'))"
test -f /opt/mycc-agent-runtime/bridge.mjs
rg --version
git --version
python3 --version
gcc --version
make --version
find --version
gawk --version
lsof -v
tree --version
pwd
whoami
```

Expected:

- `whoami` prints `mycc`
- `pwd` prints `/home/mycc/workspace`
- All version commands succeed
