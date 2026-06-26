import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerReadinessRoutes } from './readiness.js';

describe('readiness routes', () => {
  async function buildApp(env: NodeJS.ProcessEnv = {}) {
    const app = Fastify({ logger: false });
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const checkRuntime = vi.fn().mockResolvedValue({
      status: 'pass' as const,
      message: 'E2B Agent preflight ready',
    });
    const checkSsh = vi.fn().mockResolvedValue(true);
    const validateSkills = vi.fn().mockReturnValue([]);

    await app.register(registerReadinessRoutes, {
      env,
      checkDatabase,
      checkRuntime,
      checkSsh,
      validateSkills,
    });

    return { app, checkDatabase, checkRuntime, checkSsh, validateSkills };
  }

  it('does not return deep readiness internals without authorization in production', async () => {
    const { app, checkDatabase, checkRuntime } = await buildApp({
      NODE_ENV: 'production',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/readyz/deep',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'readyz_deep_unauthorized',
      status: 'unauthorized',
    });
    expect(response.body).not.toMatch(/database|ssh|skills|runtime|E2B/i);
    expect(checkDatabase).not.toHaveBeenCalled();
    expect(checkRuntime).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns deep readiness details for an authorized operations request', async () => {
    const { app, checkRuntime } = await buildApp({
      NODE_ENV: 'production',
      MYCC_READYZ_DEEP_TOKEN: 'ops-secret',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/readyz/deep',
      headers: {
        authorization: 'Bearer ops-secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ready: true,
      status: 'ok',
      checks: {
        database: { status: 'pass' },
        runtime: { status: 'pass', message: 'E2B Agent preflight ready' },
      },
    });
    expect(checkRuntime).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('keeps public liveness and readiness endpoints available without the deep token', async () => {
    const { app } = await buildApp({
      NODE_ENV: 'production',
    });

    const health = await app.inject({
      method: 'GET',
      url: '/health',
    });
    const readiness = await app.inject({
      method: 'GET',
      url: '/readyz',
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: 'ok',
      service: 'mycc-backend',
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({
      ready: true,
      status: 'ok',
      checks: {
        database: { status: 'pass' },
        runtime: {
          status: 'skipped',
          message: 'Runtime deep check not requested',
        },
      },
    });

    await app.close();
  });
});
