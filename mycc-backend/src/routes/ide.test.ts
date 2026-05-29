import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ideRoutes, type IdeRoutesOptions } from './ide.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(overrides: Partial<{ userId: number; linuxUser: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: overrides.linuxUser ?? 'tester',
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
        openPath: expect.stringMatching(/^\/api\/ide\/sessions\/.+\/open\?token=.+/),
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
        openPath: expect.stringMatching(new RegExp(`^/api/ide/sessions/${id}/open\\?token=.+`)),
      },
    });
  });

  it('exchanges an IDE open token for an httpOnly proxy cookie', async () => {
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
    const openPath = created.json().data.openPath;

    const response = await app.inject({
      method: 'GET',
      url: openPath,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(openPath.replace(/\/open\?token=.+$/, '/proxy/'));
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'));
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('Path=/api/ide/sessions/'));
    expect(JSON.stringify(response.headers)).not.toContain('secret-token');
    expect(JSON.stringify(response.headers)).not.toContain('18080-sbx_123.e2b.app');
  });

  it('renews a running IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const renewCodeServer = vi.fn().mockImplementation(async (session) => ({
      ...session,
      expiresAt: '2026-05-29T15:00:00.000Z',
    }));
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
        renewCodeServer,
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/ide/sessions/${id}/renew`,
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(renewCodeServer).toHaveBeenCalledWith(expect.objectContaining({
      sandboxId: 'sbx_123',
      trafficAccessToken: 'secret-token',
    }), 3600);
    expect(response.json().data.expiresAt).toBe('2026-05-29T15:00:00.000Z');
    expect(JSON.stringify(response.json())).not.toContain('secret-token');
  });

  it('stops a running IDE session and keeps provider secrets private', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const stopCodeServer = vi.fn().mockResolvedValue(undefined);
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
        stopCodeServer,
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/ide/sessions/${id}`,
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(stopCodeServer).toHaveBeenCalledWith(expect.objectContaining({
      sandboxId: 'sbx_123',
      trafficAccessToken: 'secret-token',
    }));
    expect(response.json()).toEqual({
      success: true,
      data: expect.objectContaining({
        id,
        status: 'stopped',
      }),
    });
    expect(JSON.stringify(response.json())).not.toContain('secret-token');
  });

  it('does not allow another user to inspect or control an IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const renewCodeServer = vi.fn();
    const stopCodeServer = vi.fn();
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
        renewCodeServer,
        stopCodeServer,
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    const otherUser = authHeader({ userId: 43, linuxUser: 'other' });

    const status = await app.inject({
      method: 'GET',
      url: `/api/ide/sessions/${id}/status`,
      headers: { authorization: otherUser },
    });
    const renew = await app.inject({
      method: 'POST',
      url: `/api/ide/sessions/${id}/renew`,
      headers: { authorization: otherUser },
    });
    const stop = await app.inject({
      method: 'DELETE',
      url: `/api/ide/sessions/${id}`,
      headers: { authorization: otherUser },
    });

    expect(status.statusCode).toBe(404);
    expect(renew.statusCode).toBe(404);
    expect(stop.statusCode).toBe(404);
    expect(renewCodeServer).not.toHaveBeenCalled();
    expect(stopCodeServer).not.toHaveBeenCalled();
  });

  it('does not renew a stopped IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const renewCodeServer = vi.fn();
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
        renewCodeServer,
        stopCodeServer: vi.fn().mockResolvedValue(undefined),
      },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    await app.inject({
      method: 'DELETE',
      url: `/api/ide/sessions/${id}`,
      headers: { authorization: authHeader() },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/ide/sessions/${id}/renew`,
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'IDE session is not running' });
    expect(renewCodeServer).not.toHaveBeenCalled();
  });

  it('proxies an owned running IDE session with E2B traffic token injection', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const web = vi.fn((req, res) => {
      expect(req.url).toBe('/healthz?ready=1');
      res.statusCode = 204;
      res.end();
    });
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
      proxyServer: { web },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/ide/sessions/${id}/proxy/healthz?ready=1`,
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(204);
    expect(web).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        target: 'https://18080-sbx_123.e2b.app',
        changeOrigin: true,
        headers: {
          'e2b-traffic-access-token': 'secret-token',
        },
      }),
      expect.any(Function),
    );
  });

  it('proxies browser requests authorized by the IDE proxy cookie', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const web = vi.fn((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
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
      proxyServer: { web },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    const open = await app.inject({
      method: 'GET',
      url: created.json().data.openPath,
    });
    const cookie = Array.isArray(open.headers['set-cookie'])
      ? open.headers['set-cookie'][0]
      : open.headers['set-cookie'];

    const response = await app.inject({
      method: 'GET',
      url: `/api/ide/sessions/${id}/proxy/healthz`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(web).toHaveBeenCalledOnce();
  });
});
