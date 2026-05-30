import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const templateTs = path.join(backendRoot, 'templates/e2b-code-server/template.ts');
const dockerfile = path.join(backendRoot, 'templates/e2b-code-server/e2b.Dockerfile');
const readme = path.join(backendRoot, 'templates/e2b-code-server/README.md');
const createTemplateScript = path.join(backendRoot, 'scripts/create-e2b-code-server-template.sh');

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

  it('pins template runtime packages to the current verified patch versions', () => {
    const source = readFileSync(dockerfile, 'utf8');

    expect(source).toContain('ARG CODE_SERVER_VERSION=4.106.3');
    expect(source).toContain('ARG CLAUDE_CODE_VERSION=2.1.158');
    expect(source).toContain('ARG CLAUDE_AGENT_SDK_VERSION=0.3.158');
    expect(source).toContain('@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}');
    expect(source).toContain('@anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION}');
  });

  it('keeps the manual README ready command aligned with the SDK bridge contract', () => {
    const source = readFileSync(readme, 'utf8');

    expect(source).toContain('cd /opt/mycc-agent-runtime');
    expect(source).toContain('import(\\"@anthropic-ai/claude-agent-sdk\\")');
    expect(source).toContain('test -f /opt/mycc-agent-runtime/bridge.mjs');
  });

  it('documents the E2B CLI access token gate for template builds', () => {
    const script = readFileSync(createTemplateScript, 'utf8');
    const docs = readFileSync(readme, 'utf8');

    expect(script).toContain('E2B_ACCESS_TOKEN');
    expect(script).toContain('https://e2b.dev/dashboard?tab=personal');
    expect(script).toContain('npx --yes @e2b/cli template create');
    expect(script).toContain('test -f /opt/mycc-agent-runtime/bridge.mjs');
    expect(docs).toContain('E2B_ACCESS_TOKEN');
    expect(docs).toContain('npm run template:e2b-code-server:create');
  });
});
