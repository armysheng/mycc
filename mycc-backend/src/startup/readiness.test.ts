import { describe, expect, it, vi } from 'vitest';
import {
  authorizeDeepReadinessRequest,
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

  it('denies deep readiness details by default when no token is configured', () => {
    for (const env of [{}, { NODE_ENV: 'production' }]) {
      const decision = authorizeDeepReadinessRequest({
        env,
        headers: {},
      });

      expect(decision.authorized).toBe(false);
      if (!decision.authorized) {
        expect(decision.statusCode).toBe(401);
        expect(JSON.stringify(decision.body)).not.toMatch(/database|ssh|skills|runtime|E2B/i);
      }
    }
  });

  it('authorizes deep readiness with bearer or header token when configured', () => {
    const env = {
      NODE_ENV: 'production',
      MYCC_READYZ_DEEP_TOKEN: 'ops-secret',
    };

    expect(
      authorizeDeepReadinessRequest({
        env,
        headers: { authorization: 'Bearer ops-secret' },
      }).authorized,
    ).toBe(true);
    expect(
      authorizeDeepReadinessRequest({
        env,
        headers: { 'x-mycc-readyz-deep-token': 'ops-secret' },
      }).authorized,
    ).toBe(true);
    expect(
      authorizeDeepReadinessRequest({
        env,
        headers: { authorization: 'Bearer wrong-secret' },
      }).authorized,
    ).toBe(false);
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
