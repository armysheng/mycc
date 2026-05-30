import { describe, expect, it, vi } from 'vitest';
import { ensureE2bIdeSession } from './e2b-session.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from './session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_123',
  codeServerPid: 1234,
  host: '18080-sbx_123.e2b.app',
  trafficAccessToken: 'traffic-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

describe('ensureE2bIdeSession', () => {
  it('reuses a running session for the user', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(runningSession);
    const startCodeServer = vi.fn();

    const session = await ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    expect(session).toBe(runningSession);
    expect(startCodeServer).not.toHaveBeenCalled();
  });

  it('creates and stores a new E2B IDE session when none is reusable', async () => {
    const store = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_new',
      codeServerPid: 4321,
      host: '18080-sbx_new.e2b.app',
      trafficAccessToken: 'new-traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });

    const session = await ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    expect(startCodeServer).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'e2b',
      userId: 42,
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
    }));
    expect(session).toEqual(expect.objectContaining({
      provider: 'e2b',
      sandboxId: 'sbx_new',
      userId: 42,
      status: 'running',
      proxyToken: expect.any(String),
    }));
    expect(await store.findReusableByUser(42)).toEqual(session);
  });
});
