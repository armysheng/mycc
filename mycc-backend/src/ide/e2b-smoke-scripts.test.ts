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
    expect(output).toContain('[error] Claude provider credential: No Claude credential is configured.');
    expect(output).toContain('[skip] E2B template: Skipped remote template check for mycc-assistant-sandbox-dev');
    expect(output).toContain('fix the preflight checklist above');
    expect(output).not.toContain('openai-secret-should-not-leak');
  }, 20_000);

  it('keeps IDE smoke pinned to MyCC proxy-only E2B access', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/smoke-e2b-ide.ts'), 'utf8');

    expect(source).toContain('runSmokeWithCleanup');
    expect(source).toContain("label: 'E2B IDE smoke'");
    expect(source).toContain('finally');
    expect(source).toContain('await pool.end()');
    expect(source).toContain('assertDirectHostRejectsUnauthenticatedTraffic');
    expect(source).toContain('https://${session.host}/healthz');
    expect(source).toContain('Direct E2B host accepted unauthenticated traffic');
    expect(source).toContain('waitForProxyHealth');
    expect(source).toContain("headers: { cookie }");
    expect(source).not.toContain('cookies.join');
    expect(source).toContain('cookies.length');
  });

  it('keeps agent workspace smoke polling code-server health after command failures', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/smoke-e2b-agent-workspace.ts'), 'utf8');

    expect(source).toContain('runSmokeWithCleanup');
    expect(source).toContain("label: 'E2B Agent+IDE workspace smoke'");
    expect(source).toContain('assertCodeServerLocalHealth');
    expect(source).toContain('lastError = error instanceof Error ? error.message : String(error)');
    expect(source).toContain('code-server health check timed out');
  });

  it('keeps agent workspace smoke evidence from printing raw sandbox ids', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/smoke-e2b-agent-workspace.ts'), 'utf8');

    expect(source).not.toContain('sandbox=${session.sandboxId}');
    expect(source).toContain('formatSmokeSandboxRef(session.sandboxId)');
  });

  it('keeps desktop smoke pinned to MyCC proxy-only E2B access', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/smoke-e2b-desktop.ts'), 'utf8');

    expect(source).toContain('runSmokeWithCleanup');
    expect(source).toContain("label: 'E2B desktop smoke'");
    expect(source).toContain('finally');
    expect(source).toContain('await pool.end()');
    expect(source).toContain('assertDirectDesktopHostRejectsUnauthenticatedTraffic');
    expect(source).toContain('https://${session.desktopHost}/vnc.html');
    expect(source).toContain('Direct E2B desktop host accepted unauthenticated traffic');
    expect(source).toContain('waitForNoVncProxy');
    expect(source).toContain("headers: { cookie }");
    expect(source).toContain('/desktop/proxy');
    expect(source).toContain('assertNoProviderSecrets');
    expect(source).not.toContain('cookies.join');
    expect(source).toContain('cookies.length');
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
