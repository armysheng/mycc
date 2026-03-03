import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configScript = path.join(backendRoot, 'scripts/migrate-mcp-search-config.sh');
const serverScript = path.join(backendRoot, 'scripts/migrate-mcp-server-duckduckgo.sh');

function run(command: string, args: string[] = []): string {
  return execFileSync(command, args, {
    cwd: backendRoot,
    encoding: 'utf8',
  });
}

describe('mcp search migration scripts', () => {
  it('migrate-mcp-search-config.sh: bash -n and no-user dry run', () => {
    run('bash', ['-n', configScript]);
    const output = run(configScript, ['__no_user__']);
    expect(output).toContain('[SUMMARY]');
    expect(output).toContain('total=0');
    expect(output).toContain('errors=0');
  });

  it('migrate-mcp-server-duckduckgo.sh: bash -n and no-user dry run', () => {
    run('bash', ['-n', serverScript]);
    const output = run(serverScript, ['__no_user__']);
    expect(output).toContain('[SUMMARY]');
    expect(output).toContain('users=0');
    expect(output).toContain('errors=0');
  });
});
