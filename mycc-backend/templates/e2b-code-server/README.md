# E2B code-server Template

This template builds the `mycc-code-server-dev` sandbox image used by the MyCC E2B GNU sandbox path.

It installs:

- GNU/Linux userland and build tools: `bash`, `coreutils`, `findutils`, `grep`, `sed`, `gawk`, `tar`, `gzip`, `git`, `openssh-client`, `ripgrep`, `jq`, `build-essential`, `make`, `pkg-config`, `python3`, `python3-venv`, `python3-pip`, `lsof`, `net-tools`, `file`, `tree`, `less`, `vim`, `nano`, `zip`, `unzip`
- GNU desktop prerequisites: `xvfb`, `xfce4`, `x11vnc`, `novnc`, `websockify`, `dbus-x11`, `x11-utils`, `xdotool`
- Node.js 22 and npm
- `code-server`
- `@anthropic-ai/claude-code`
- `@musistudio/claude-code-router` with the `ccr` CLI
- `@anthropic-ai/claude-agent-sdk` and the mycc Agent SDK bridge in `/opt/mycc-agent-runtime`

The default sandbox user is `mycc` and the default workspace is `/home/mycc/workspace`.

The intended runtime model is:

- `ccr-router` runs inside the sandbox image and reads provider base URL/token from runtime env injected by MyCC.
- Claude CLI and Agent SDK bridge talk to the sandbox-local CCR endpoint.
- `code-server`, MyCC workspace file APIs, Agent runtime, and desktop all operate on `/home/mycc/workspace`.
- MyCC proxies browser traffic to sandbox services; browsers must not receive raw E2B hosts, E2B traffic tokens, provider base URLs, or provider tokens.

## Build

Run this manually; do not wire it into the normal backend build.

The E2B SDK/API key is enough for smoke tests, but template builds use the E2B CLI auth flow. Before building, either run `npx --yes @e2b/cli auth login` or set `E2B_ACCESS_TOKEN` from <https://e2b.dev/dashboard?tab=personal>.

Recommended:

```bash
cd mycc-backend
npm run template:e2b-code-server:create
```

Equivalent raw CLI command:

```bash
cd mycc-backend/templates/e2b-code-server
e2b template create mycc-code-server-dev \
  --path . \
  --dockerfile e2b.Dockerfile \
  --ready-cmd 'code-server --version && node --version && npm --version && claude --version && ccr --help >/dev/null && cd /opt/mycc-agent-runtime && node -e "import(\"@anthropic-ai/claude-agent-sdk\").then(() => console.log(\"agent-sdk ok\"))" && test -f /opt/mycc-agent-runtime/bridge.mjs && python3 -m venv /tmp/mycc-ready-venv && /tmp/mycc-ready-venv/bin/python -m pip --version && rg --version && jq --version && file --version && git --version && python3 --version && gcc --version && make --version && find --version && gawk --version && lsof -v && tree --version && command -v Xvfb && command -v startxfce4 && command -v x11vnc && command -v websockify && command -v dbus-launch && command -v xdpyinfo'
```

If the template already exists, use the equivalent E2B CLI update/build flow for your account.

## Runtime Contract

The backend starts sandbox services dynamically; this template should not start `ccr`, `code-server`, or desktop as a default command.

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
- `CLAUDE_CONFIG_DIR=/home/mycc/.claude`
- `HOME=/home/mycc`

For the target sandbox-local CCR path, MyCC should inject provider credentials into the `ccr-router` service, not into every user-facing process. Claude CLI and Agent SDK bridge should receive only the local CCR endpoint and router auth key, for example:

- `ANTHROPIC_BASE_URL=http://127.0.0.1:<ccr-port>`
- `ANTHROPIC_AUTH_TOKEN=<sandbox-local-router-key>`

The upstream provider base URL/token should be present only in the CCR process env or a restricted CCR config/secret file.

The product default allowed tools cover normal workspace work (`Read,Glob,Grep,Bash,Edit,Write`) with `bypassPermissions`; system protection comes from MyCC hooks and sandbox policy. Override `MYCC_AGENT_SDK_ALLOWED_TOOLS` / `MYCC_AGENT_SDK_PERMISSION_MODE` only for narrow experiments.

## Smoke Checks

After creating a sandbox from `mycc-code-server-dev`, run:

```bash
code-server --version
node --version
npm --version
claude --version
ccr --help >/dev/null
cd /opt/mycc-agent-runtime && node -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('agent-sdk ok'))"
test -f /opt/mycc-agent-runtime/bridge.mjs
python3 -m venv /tmp/mycc-smoke-venv
/tmp/mycc-smoke-venv/bin/python -m pip --version
rg --version
jq --version
file --version
git --version
python3 --version
gcc --version
make --version
find --version
gawk --version
lsof -v
tree --version
command -v Xvfb
command -v startxfce4
command -v x11vnc
command -v websockify
command -v dbus-launch
command -v xdpyinfo
pwd
whoami
```

Expected:

- `whoami` prints `mycc`
- `pwd` prints `/home/mycc/workspace`
- All version commands succeed
