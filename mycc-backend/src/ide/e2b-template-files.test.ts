import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templateTs = path.join(backendRoot, 'templates/e2b-code-server/template.ts');

describe('E2B code-server template files', () => {
  it('keeps the SDK template ready command aligned with the GNU/native contract', () => {
    const source = readFileSync(templateTs, 'utf8');

    for (const command of [
      'code-server --version',
      'node --version',
      'npm --version',
      'claude --version',
      'rg --version',
      'git --version',
      'python3 --version',
      'gcc --version',
      'make --version',
      'find --version',
      'gawk --version',
      'lsof -v',
      'tree --version',
      'test -f /opt/mycc-agent-runtime/bridge.mjs',
    ]) {
      expect(source).toContain(command);
    }
  });
});
