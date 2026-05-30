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
    'cd /opt/mycc-agent-runtime && node -e "import(\'@anthropic-ai/claude-agent-sdk\').then(() => console.log(\'agent-sdk ok\'))"',
    'test -f /opt/mycc-agent-runtime/bridge.mjs',
    'rg --version',
    'git --version',
    'python3 --version',
    'gcc --version',
    'make --version',
    'find --version',
    'gawk --version',
    'lsof -v',
    'tree --version',
  ].join(' && '));
