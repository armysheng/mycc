import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ideRoutes, type IdeRoutesOptions } from './ide.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(): string {
  const token = jwt.sign({
    userId: 42,
    linuxUser: 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: IdeRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(ideRoutes, options);
  return app;
}

describe('ide routes', () => {
  afterEach(() => {
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
  });

  it('reports IDE capability as disabled by default', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/config',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        provider: 'disabled',
        enabled: false,
        codeServerPort: 18080,
        sessionTtlSeconds: 3600,
        accessMode: 'mycc-proxy',
      },
    });
  });

  it('returns 501 when creating an IDE plan while provider is disabled', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions/plan',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: 'IDE provider is disabled',
    });
  });

  it('returns an E2B proxy-only IDE session plan when enabled', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions/plan',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        provider: 'e2b',
        template: 'mycc-code-server-dev',
        userId: 42,
        linuxUser: 'tester',
        workspaceDir: '/home/tester/workspace',
        port: 18080,
        sessionTtlSeconds: 3600,
        allowPublicTraffic: false,
        accessMode: 'mycc-proxy',
      },
    });
  });

  it('starts an E2B IDE session without exposing provider secrets', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'secret-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });
    const app = await buildApp({ e2bProvider: { startCodeServer } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      success: true,
      data: {
        id: expect.any(String),
        provider: 'e2b',
        sandboxId: 'sbx_123',
        codeServerPid: 1234,
        port: 18080,
        accessMode: 'mycc-proxy',
        status: 'running',
        expiresAt: '2026-05-29T14:00:00.000Z',
        openPath: expect.stringMatching(/^\/api\/ide\/sessions\/.+\/proxy\/$/),
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('18080-sbx_123.e2b.app');
    expect(startCodeServer).toHaveBeenCalledOnce();
  });

  it('returns stored IDE session status without provider secrets', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const app = await buildApp({
      e2bProvider: {
        startCodeServer: vi.fn().mockResolvedValue({
          provider: 'e2b',
          sandboxId: 'sbx_123',
          codeServerPid: 1234,
          host: '18080-sbx_123.e2b.app',
          trafficAccessToken: 'secret-token',
          port: 18080,
          accessMode: 'mycc-proxy',
          expiresAt: '2026-05-29T14:00:00.000Z',
        }),
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    const response = await app.inject({
      method: 'GET',
      url: `/api/ide/sessions/${id}/status`,
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        id,
        provider: 'e2b',
        sandboxId: 'sbx_123',
        codeServerPid: 1234,
        port: 18080,
        accessMode: 'mycc-proxy',
        status: 'running',
        expiresAt: '2026-05-29T14:00:00.000Z',
        openPath: `/api/ide/sessions/${id}/proxy/`,
      },
    });
  });
});
