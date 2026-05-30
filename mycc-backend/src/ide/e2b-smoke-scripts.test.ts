import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('E2B workspace smoke scripts', () => {
  it.each([
    'smoke:e2b-agent-workspace',
    'smoke:e2b-agent-sdk-workspace',
  ])('prints the preflight checklist before failing %s', async (scriptName) => {
    const output = await runExpectedFailure(scriptName);

    expect(output).toContain('E2B Agent preflight: needs attention');
    expect(output).toContain('[error] E2B API key: Missing MYCC_E2B_API_KEY or E2B_API_KEY.');
    expect(output).toContain('[error] Claude/CCR credential: No Claude credential is configured.');
    expect(output).toContain('[skip] E2B template: Skipped remote template check for mycc-code-server-dev');
    expect(output).toContain('fix the preflight checklist above');
    expect(output).not.toContain('openai-secret-should-not-leak');
  });

  it('keeps IDE smoke pinned to MyCC proxy-only E2B access', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/smoke-e2b-ide.ts'), 'utf8');

    expect(source).toContain('assertDirectHostRejectsUnauthenticatedTraffic');
    expect(source).toContain('https://${session.host}/healthz');
    expect(source).toContain('Direct E2B host accepted unauthenticated traffic');
    expect(source).toContain('waitForProxyHealth');
    expect(source).toContain("headers: { cookie }");
  });
});

async function runExpectedFailure(scriptName: string): Promise<string> {
  try {
    await execFileAsync('npm', ['run', '--silent', scriptName], {
      cwd: new URL('../..', import.meta.url),
      env: {
        ...process.env,
        MYCC_E2B_API_KEY: '',
        E2B_API_KEY: '',
        MYCC_E2B_TEMPLATE: '',
        MYCC_CCR_AUTH_TOKEN: '',
        MYCC_CCR_API_KEY: '',
        MYCC_CLAUDE_AUTH_TOKEN: '',
        MYCC_CLAUDE_API_KEY: '',
        MYCC_AGENT_SDK_AUTH_TOKEN: '',
        MYCC_AGENT_SDK_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
        VPS_ANTHROPIC_AUTH_TOKEN: '',
        OPENAI_API_KEY: 'openai-secret-should-not-leak',
      },
      timeout: 15_000,
    });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number | string };
    expect(failed.code).not.toBe(0);
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
  }

  throw new Error(`Expected ${scriptName} to fail preflight`);
}
