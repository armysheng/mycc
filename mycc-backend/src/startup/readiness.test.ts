import { describe, expect, it, vi } from 'vitest';
import {
  buildHealthResponse,
  buildReadinessResponse,
  requireProductionStartupSecrets,
} from './readiness.js';

describe('startup health and readiness', () => {
  it('keeps liveness independent from provider dependencies', () => {
    expect(buildHealthResponse()).toEqual({
      status: 'ok',
      service: 'mycc-backend',
      timestamp: expect.any(String),
    });
  });

  it('marks readiness unavailable when database check fails', async () => {
    const response = await buildReadinessResponse({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
      },
      checkDatabase: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      checkSsh: vi.fn(),
      validateSkills: vi.fn().mockReturnValue([]),
    });

    expect(response.ready).toBe(false);
    expect(response.checks.database.status).toBe('fail');
    expect(response.checks.ssh.status).toBe('skipped');
    expect(response.checks.runtime.status).toBe('skipped');
  });

  it('can include a deep runtime readiness check', async () => {
    const response = await buildReadinessResponse({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
      },
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkRuntime: vi.fn().mockResolvedValue({
        status: 'fail',
        message: 'E2B Agent preflight failed: E2B template',
      }),
      checkSsh: vi.fn(),
      validateSkills: vi.fn().mockReturnValue([]),
    });

    expect(response.ready).toBe(false);
    expect(response.status).toBe('unavailable');
    expect(response.checks.runtime).toEqual({
      status: 'fail',
      message: 'E2B Agent preflight failed: E2B template',
    });
  });

  it('requires production JWT safety before startup', () => {
    expect(() =>
      requireProductionStartupSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'your_jwt_secret_change_in_production',
      }),
    ).toThrow(/JWT_SECRET/);
  });
});
