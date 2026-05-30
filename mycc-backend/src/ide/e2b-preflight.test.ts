import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertE2bAgentPreflightReady,
  buildE2bAgentPreflightReport,
  formatE2bAgentPreflightReport,
  type E2bPreflightReport,
} from './e2b-preflight.js';

function check(report: E2bPreflightReport, id: string) {
  const result = report.checks.find((item) => item.id === id);
  if (!result) throw new Error(`Missing check: ${id}`);
  return result;
}

describe('E2B Agent preflight', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports the required external configuration without leaking secrets', async () => {
    const report = await buildE2bAgentPreflightReport({ env: {} });
    const output = formatE2bAgentPreflightReport(report);

    expect(report.ok).toBe(false);
    expect(check(report, 'e2b-api-key').status).toBe('error');
    expect(check(report, 'claude-provider').status).toBe('error');
    expect(check(report, 'e2b-template-exists').status).toBe('skip');
    expect(output).toContain('MYCC_E2B_API_KEY');
    expect(output).toContain('MYCC_CCR_AUTH_TOKEN');
  });

  it('checks the remote E2B template when a valid API key is configured', async () => {
    const templateExists = vi.fn().mockResolvedValue(true);

    const report = await buildE2bAgentPreflightReport({
      env: {
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        MYCC_E2B_TEMPLATE: 'mycc-code-server-dev',
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_CCR_BASE_URL: 'http://127.0.0.1:3456',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
        MYCC_E2B_ALLOW_PUBLIC_TRAFFIC: 'false',
      },
      templateExists,
    });

    expect(report.ok).toBe(true);
    expect(templateExists).toHaveBeenCalledWith('mycc-code-server-dev', 'e2b_liveKey-ABC_123');
    expect(check(report, 'e2b-template-exists').status).toBe('ok');

    const output = formatE2bAgentPreflightReport(report);
    expect(output).not.toContain('e2b_liveKey-ABC_123');
    expect(output).not.toContain('ccr-secret');
    expect(output).not.toContain('127.0.0.1');
  });

  it('flags a missing remote E2B template as blocking', async () => {
    const report = await buildE2bAgentPreflightReport({
      env: {
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        MYCC_E2B_TEMPLATE: 'missing-template',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
      },
      templateExists: vi.fn().mockResolvedValue(false),
    });

    expect(report.ok).toBe(false);
    expect(check(report, 'e2b-template-exists')).toEqual(expect.objectContaining({
      status: 'error',
      message: expect.stringContaining('missing-template'),
    }));
  });

  it('reports remote template lookup failures without leaking the API key', async () => {
    const report = await buildE2bAgentPreflightReport({
      env: {
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
      },
      templateExists: vi.fn().mockRejectedValue(new Error('401 unauthorized for e2b_liveKey-ABC_123')),
    });

    expect(report.ok).toBe(false);
    expect(check(report, 'e2b-template-exists').status).toBe('error');
    const output = formatE2bAgentPreflightReport(report);
    expect(output).toContain('Remote E2B template lookup failed');
    expect(output).not.toContain('e2b_liveKey-ABC_123');
  });

  it('throws a doctor-style checklist for smoke preflight gaps without leaking secrets', async () => {
    await expect(assertE2bAgentPreflightReady({ env: {} }))
      .rejects.toThrowError(expect.objectContaining({
        message: expect.stringContaining('E2B Agent preflight: needs attention'),
      }));

    let missingConfigError: unknown;
    try {
      await assertE2bAgentPreflightReady({ env: {} });
    } catch (error) {
      missingConfigError = error;
    }
    const missingConfigOutput = missingConfigError instanceof Error ? missingConfigError.message : String(missingConfigError);
    expect(missingConfigOutput).toContain('[error] E2B API key: Missing MYCC_E2B_API_KEY or E2B_API_KEY.');
    expect(missingConfigOutput).toContain('[error] Claude/CCR credential: No Claude credential is configured.');
    expect(missingConfigOutput).toContain('[skip] E2B template: Skipped remote template check for mycc-code-server-dev');

    await expect(assertE2bAgentPreflightReady({
      env: {
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        MYCC_E2B_TEMPLATE: 'missing-template',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
      },
      templateExists: vi.fn().mockResolvedValue(false),
    })).rejects.toThrowError(expect.objectContaining({
      message: expect.stringContaining('[error] E2B template: E2B template does not exist: missing-template.'),
    }));

    try {
      await assertE2bAgentPreflightReady({
        env: {
          MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
          MYCC_E2B_TEMPLATE: 'missing-template',
          MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
        },
        templateExists: vi.fn().mockResolvedValue(false),
      });
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      expect(output).not.toContain('e2b_liveKey-ABC_123');
      expect(output).not.toContain('ccr-secret');
    }
  });

  it('does not let host process credentials satisfy an explicit empty env preflight', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'host-secret');

    const report = await buildE2bAgentPreflightReport({ env: {} });

    expect(check(report, 'claude-provider').status).toBe('error');
  });

  it('warns about ignored global OpenAI env and mixed VPS/Anthropic credentials', async () => {
    const report = await buildE2bAgentPreflightReport({
      env: {
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        VPS_ANTHROPIC_BASE_URL: 'https://vps.example.test',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
        OPENAI_BASE_URL: 'https://openai-compatible.example.test/v1',
        OPENAI_API_KEY: 'openai-secret',
      },
    });

    expect(check(report, 'global-openai-env').status).toBe('warn');
    expect(check(report, 'claude-provider-consistency').status).toBe('warn');
    const output = formatE2bAgentPreflightReport(report);
    expect(output).not.toContain('openai-secret');
    expect(output).not.toContain('sk-ant-secret');
    expect(output).not.toContain('vps.example.test');
  });
});
