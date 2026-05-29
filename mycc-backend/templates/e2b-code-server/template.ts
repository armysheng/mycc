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
    'rg --version',
    'git --version',
    'python3 --version',
    'gcc --version',
  ].join(' && '));
