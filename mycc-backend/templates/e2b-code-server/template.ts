import { Template } from 'e2b';

export const template = Template()
  .fromDockerfile('./e2b.Dockerfile')
  .setUser('mycc')
  .setWorkdir('/home/mycc/workspace')
  .setReadyCmd([
    'code-server --version',
    'node --version',
    'npm --version',
    'claude --version',
    'ccr --help >/dev/null',
    'cd /opt/mycc-agent-runtime && node -e "import(\'@anthropic-ai/claude-agent-sdk\').then(() => console.log(\'agent-sdk ok\'))"',
    'test -f /opt/mycc-agent-runtime/bridge.mjs',
    'python3 -m venv /tmp/mycc-ready-venv',
    '/tmp/mycc-ready-venv/bin/python -m pip --version',
    'rg --version',
    'jq --version',
    'file --version',
    'git --version',
    'python3 --version',
    'gcc --version',
    'make --version',
    'find --version',
    'gawk --version',
    'lsof -v',
    'tree --version',
    'command -v Xvfb',
    'command -v startxfce4',
    'command -v x11vnc',
    'command -v websockify',
    'command -v dbus-launch',
    'command -v xdpyinfo',
  ].join(' && '));
