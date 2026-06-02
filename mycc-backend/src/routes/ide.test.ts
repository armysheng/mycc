import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ideRoutes, type IdeRoutesOptions } from './ide.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_123',
  codeServerPid: 1234,
  host: '18080-sbx_123.e2b.app',
  trafficAccessToken: 'secret-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

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
  await app.register(ideRoutes, {
    ...options,
    sessionStore: options.sessionStore ?? new InMemoryIdeSessionStore(),
  });
  return app;
}

function firstSetCookie(response: { headers: Record<string, number | string | string[] | undefined> }) {
  const setCookie = response.headers['set-cookie'];
  if (Array.isArray(setCookie)) {
    return setCookie[0];
  }
  return typeof setCookie === 'string' ? setCookie : undefined;
}

const INTERNAL_PUBLIC_IDE_KEYS = new Set([
  'provider',
  'sandboxId',
  'codeServerPid',
  'host',
  'trafficAccessToken',
  'port',
  'accessMode',
  'proxyToken',
  'template',
  'e2bTemplate',
  'codeServerPort',
  'desktopPort',
  'sessionTtlSeconds',
  'allowPublicTraffic',
  'workspaceDir',
  'linuxUser',
]);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function expectPublicIdePayload(value: unknown) {
  const keys = collectKeys(value);
  for (const key of INTERNAL_PUBLIC_IDE_KEYS) {
    expect(keys.has(key), `public IDE payload leaked key "${key}"`).toBe(false);
  }
  expect(JSON.stringify(value)).not.toMatch(
    /e2b\.app|sbx_|secret-token|proxy-token|mycc-code-server-dev|mycc-assistant-sandbox-dev|\/home\/mycc|18080-sbx|16080-sbx/i,
  );
}

function expectPublicIdeError(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /\bIDE\b|E2B|GNU|Desktop|code-server|sandbox|provider|\btoken\b|proxy failed/i,
  );
}

describe('ide routes', () => {
  beforeEach(() => {
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
    delete process.env.MYCC_E2B_DESKTOP_ENABLED;
    delete process.env.MYCC_E2B_DESKTOP_PORT;
  });

  afterEach(() => {
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
    delete process.env.MYCC_E2B_DESKTOP_ENABLED;
    delete process.env.MYCC_E2B_DESKTOP_PORT;
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
        enabled: false,
        desktopEnabled: false,
      },
    });
    expectPublicIdePayload(response.json());
  });

  it('can be imported by the tsx runtime used by npm run dev', () => {
    const tsxBin = path.join(process.cwd(), 'node_modules/.bin/tsx');

    expect(() => execFileSync(tsxBin, ['-e', "import('./src/routes/ide.ts').then(() => {})"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MYCC_IDE_PROVIDER: '',
        MYCC_E2B_TEMPLATE: '',
      },
      stdio: 'pipe',
    })).not.toThrow();
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
      error: '工作间当前未启用',
    });
    expectPublicIdePayload(response.json());
  });

  it('returns a product-level workbench plan when enabled', async () => {
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
        enabled: true,
        desktopEnabled: false,
      },
    });
    expectPublicIdePayload(response.json());
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
      expiresAt: '2099-05-29T14:00:00.000Z',
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
        status: 'running',
        expiresAt: '2099-05-29T14:00:00.000Z',
        openPath: expect.stringMatching(/^\/api\/ide\/sessions\/.+\/proxy\/$/),
      },
    });
    expectPublicIdePayload(body);
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(JSON.stringify(body)).not.toContain('18080-sbx_123.e2b.app');
    expect(JSON.stringify(body)).not.toContain('sbx_123');
    expect(JSON.stringify(body)).not.toContain('token=');
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('HttpOnly'));
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('/proxy'));
    expect(startCodeServer).toHaveBeenCalledOnce();
  });

  it('keeps IDE session creation failures product-facing without leaking provider details', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const startCodeServer = vi.fn().mockRejectedValue(
      new Error('500: Failed to place sandbox; token=secret-token; host=18080-sbx_123.e2b.app'),
    );
    const app = await buildApp({ e2bProvider: { startCodeServer } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: '工作间暂时连接失败' });
    expectPublicIdeError(response.json());
    expect(JSON.stringify(response.json())).not.toContain('secret-token');
    expect(JSON.stringify(response.json())).not.toContain('18080-sbx_123.e2b.app');
    expect(JSON.stringify(response.json())).not.toContain('sbx_123');
  });

  it('reuses an existing running IDE session for the same user', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'secret-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const app = await buildApp({ e2bProvider: { startCodeServer } });

    const first = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(second.json().data.openPath).toBe(first.json().data.openPath);
    expect(startCodeServer).toHaveBeenCalledOnce();
  });

  it('starts GNU desktop in the existing E2B sandbox and keeps provider secrets private', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-assistant-sandbox-dev';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const startCodeServer = vi.fn();
    const startDesktop = vi.fn().mockResolvedValue({
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
    const app = await buildApp({
      sessionStore,
      e2bProvider: {
        startCodeServer,
        startDesktop,
      } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions/ide_123/desktop',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(startDesktop).toHaveBeenCalledWith(runningSession);
    expect(startCodeServer).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'ide_123',
        desktop: {
          status: 'running',
          openPath: '/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify',
        },
      }),
    });
    expectPublicIdePayload(response.json());
    expect(JSON.stringify(response.json())).not.toContain('secret-token');
    expect(JSON.stringify(response.json())).not.toContain('16080-sbx_123.e2b.app');
    expect(JSON.stringify(response.json())).not.toContain('proxy-token');
    expect(JSON.stringify(response.json())).not.toContain('sbx_123');
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('HttpOnly'));
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('Path=/api/ide/sessions/ide_123/desktop/proxy'));
    await expect(sessionStore.get('ide_123')).resolves.toEqual(expect.objectContaining({
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    }));
  });

  it('replaces a reusable session when the E2B sandbox is alive but code-server is not listening', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const isCodeServerListening = vi.fn().mockResolvedValue(false);
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_replacement',
      codeServerPid: 5678,
      host: '18080-sbx_replacement.e2b.app',
      trafficAccessToken: 'replacement-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T15:00:00.000Z',
    });
    const app = await buildApp({
      sessionStore,
      e2bProvider: {
        isCodeServerListening,
        startCodeServer,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(expect.objectContaining({
      status: 'running',
      openPath: expect.stringMatching(/^\/api\/ide\/sessions\/.+\/proxy\/$/),
    }));
    expect(JSON.stringify(response.json())).not.toContain('sbx_replacement');
    expect(isCodeServerListening).toHaveBeenCalledWith(runningSession);
    expect(startCodeServer).toHaveBeenCalledOnce();
    await expect(sessionStore.get('ide_123')).resolves.toEqual(expect.objectContaining({
      status: 'stopped',
    }));
  });

  it('replaces a reusable session when the code-server health probe throws', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const isCodeServerListening = vi.fn().mockRejectedValue(new Error('exit status 1'));
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_replacement',
      codeServerPid: 5678,
      host: '18080-sbx_replacement.e2b.app',
      trafficAccessToken: 'replacement-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T15:00:00.000Z',
    });
    const app = await buildApp({
      sessionStore,
      e2bProvider: {
        isCodeServerListening,
        startCodeServer,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(expect.objectContaining({
      status: 'running',
      openPath: expect.stringMatching(/^\/api\/ide\/sessions\/.+\/proxy\/$/),
    }));
    expect(JSON.stringify(response.json())).not.toContain('exit status 1');
    expect(startCodeServer).toHaveBeenCalledOnce();
    await expect(sessionStore.get('ide_123')).resolves.toEqual(expect.objectContaining({
      status: 'stopped',
    }));
  });

  it('refreshes the proxy cookie when reusing an existing IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      sessionStore,
      e2bProvider: {
        startCodeServer: vi.fn(),
        isCodeServerListening: vi.fn().mockResolvedValue(true),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('HttpOnly'));
    expect(firstSetCookie(response)).toEqual(expect.stringContaining('Path=/api/ide/sessions/ide_123/proxy'));
    expect(response.json().data).toEqual(expect.objectContaining({
      id: 'ide_123',
      status: 'running',
    }));
  });

  it('marks stale reusable sessions stopped before returning the current IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const isCodeServerListening = vi.fn().mockResolvedValue(false);
    const app = await buildApp({
      sessionStore,
      e2bProvider: {
        startCodeServer: vi.fn(),
        isCodeServerListening,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/current',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: null,
    });
    expect(isCodeServerListening).toHaveBeenCalledWith(runningSession);
    await expect(sessionStore.get('ide_123')).resolves.toEqual(expect.objectContaining({
      status: 'stopped',
    }));
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
        status: 'running',
        expiresAt: '2026-05-29T14:00:00.000Z',
        openPath: `/api/ide/sessions/${id}/proxy/`,
      },
    });
    expectPublicIdePayload(response.json());
    expect(response.body).not.toContain('sbx_123');
    expect(response.body).not.toContain('token=');
  });

  it('returns the current reusable IDE session without creating a sandbox', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const startCodeServer = vi.fn();
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/current',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        id: 'ide_123',
        status: 'running',
        expiresAt: '2099-05-29T14:00:00.000Z',
        openPath: '/api/ide/sessions/ide_123/proxy/',
      },
    });
    expectPublicIdePayload(response.json());
    expect(JSON.stringify(response.json())).not.toContain('secret-token');
    expect(JSON.stringify(response.json())).not.toContain('18080-sbx_123.e2b.app');
    expect(response.body).not.toContain('sbx_123');
    expect(response.body).not.toContain('proxy-token');
    expect(startCodeServer).not.toHaveBeenCalled();
  });

  it('returns null for current IDE session when none is reusable without creating a sandbox', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const startCodeServer = vi.fn();
    const app = await buildApp({
      e2bProvider: { startCodeServer },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/current',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: null,
    });
    expect(startCodeServer).not.toHaveBeenCalled();
  });

  it('requires auth before returning the current IDE session', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const startCodeServer = vi.fn();
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/current',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: '未提供认证 token',
    });
    expect(startCodeServer).not.toHaveBeenCalled();
  });

  it('returns a tokenless IDE open path and a scoped httpOnly proxy cookie', async () => {
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

    expect(created.statusCode).toBe(201);
    expect(created.json().data.openPath).toBe(`/api/ide/sessions/${id}/proxy/`);
    expect(created.body).not.toContain('token=');
    expect(created.body).not.toContain('sbx_123');
    expect(firstSetCookie(created)).toEqual(expect.stringContaining('HttpOnly'));
    expect(firstSetCookie(created)).toEqual(expect.stringContaining(`Path=/api/ide/sessions/${id}/proxy`));
    expect(JSON.stringify(created.headers)).not.toContain('secret-token');
    expect(JSON.stringify(created.headers)).not.toContain('18080-sbx_123.e2b.app');
  });

  it('exchanges a GNU desktop open token for a scoped httpOnly proxy cookie', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set({
      ...runningSession,
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer: vi.fn() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/ide_123/desktop/open?token=proxy-token',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('/api/ide/sessions/ide_123/desktop/proxy/vnc.html');
    expect(response.headers.location).toContain('autoconnect=true');
    expect(response.headers.location).toContain('path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify');
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'));
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('Path=/api/ide/sessions/ide_123/desktop/proxy'));
    expect(JSON.stringify(response.headers)).not.toContain('secret-token');
    expect(JSON.stringify(response.headers)).not.toContain('16080-sbx_123.e2b.app');
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
    expect(response.json()).toEqual({ error: '工作间当前未运行' });
    expectPublicIdeError(response.json());
    expect(renewCodeServer).not.toHaveBeenCalled();
  });

  it('does not proxy browser requests without JWT or IDE proxy cookie', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const web = vi.fn();
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer: vi.fn() },
      proxyServer: { web },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/ide_123/proxy/healthz',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: '工作间暂不可用' });
    expectPublicIdeError(response.json());
    expect(web).not.toHaveBeenCalled();
  });

  it('keeps direct workbench open errors product-facing', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer: vi.fn() },
    });

    const editorOpen = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/ide_123/open?token=wrong-token',
    });
    const desktopOpen = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/ide_123/desktop/open?token=wrong-token',
    });

    expect(editorOpen.statusCode).toBe(401);
    expect(editorOpen.json()).toEqual({ error: '工作间打开凭据无效' });
    expectPublicIdeError(editorOpen.json());
    expect(desktopOpen.statusCode).toBe(401);
    expect(desktopOpen.json()).toEqual({ error: '桌面工作间打开凭据无效' });
    expectPublicIdeError(desktopOpen.json());
  });

  it('keeps disabled desktop errors product-facing', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    process.env.MYCC_E2B_DESKTOP_ENABLED = 'false';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer: vi.fn() },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions/ide_123/desktop',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: '桌面工作间当前未启用' });
    expectPublicIdeError(response.json());
  });

  it('keeps malformed workbench ids from leaking database errors', async () => {
    const badIdStore = {
      get: vi.fn().mockRejectedValue(new Error('invalid input syntax for type uuid: "missing"')),
      set: vi.fn(),
      findReusableByUser: vi.fn().mockResolvedValue(null),
      findExpiredRunning: vi.fn().mockResolvedValue([]),
    };
    const app = await buildApp({
      sessionStore: badIdStore,
      e2bProvider: { startCodeServer: vi.fn() },
    });

    const open = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/missing/open?token=bad',
    });
    const status = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/missing/status',
      headers: { authorization: authHeader() },
    });
    const proxy = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/missing/proxy/healthz',
      headers: { authorization: authHeader() },
    });

    for (const response of [open, status, proxy]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: '工作间暂不可用' });
      expect(response.body).not.toMatch(/invalid input syntax|uuid|database|SQLSTATE/i);
      expectPublicIdeError(response.json());
    }
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

  it('proxies owned GNU desktop requests with E2B traffic token injection', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set({
      ...runningSession,
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
    const web = vi.fn((req, res) => {
      expect(req.url).toBe('/vnc.html?autoconnect=true');
      res.statusCode = 204;
      res.end();
    });
    const app = await buildApp({
      sessionStore,
      e2bProvider: { startCodeServer: vi.fn() },
      proxyServer: { web },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(204);
    expect(web).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        target: 'https://16080-sbx_123.e2b.app',
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
    const cookie = firstSetCookie(created);

    const response = await app.inject({
      method: 'GET',
      url: `/api/ide/sessions/${id}/proxy/healthz`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(web).toHaveBeenCalledOnce();
  });

  it('proxies WebSocket upgrades authorized by the IDE proxy cookie', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const web = vi.fn();
    const ws = vi.fn();
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
      proxyServer: { web, ws },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    const cookie = firstSetCookie(created);
    const socket = { destroy: vi.fn() };

    app.server.emit('upgrade', {
      headers: { cookie },
      url: `/api/ide/sessions/${id}/proxy/?reconnectionToken=abc`,
    }, socket, Buffer.alloc(0));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(ws).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/?reconnectionToken=abc',
      }),
      socket,
      expect.any(Buffer),
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

  it('does not leave upgraded sockets without an error handler', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const web = vi.fn();
    const ws = vi.fn();
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
      proxyServer: { web, ws },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ide/sessions',
      headers: { authorization: authHeader() },
    });
    const id = created.json().data.id;
    const cookie = firstSetCookie(created);
    const socket = {
      destroy: vi.fn(),
      on: vi.fn(),
    };

    app.server.emit('upgrade', {
      headers: { cookie },
      url: `/api/ide/sessions/${id}/proxy/?reconnectionToken=abc`,
    }, socket, Buffer.alloc(0));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(ws).toHaveBeenCalledOnce();
  });
});
