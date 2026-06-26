import { describe, expect, it, vi } from 'vitest';
import { cleanupExpiredIdeSessions } from './session-cleanup.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from './session-store.js';

const expiredSession: StoredIdeSession = {
  id: 'ide_expired',
  provider: 'e2b',
  template: 'mycc-assistant-sandbox-dev',
  linuxUser: 'mycc',
  workspaceDir: '/home/mycc/workspace',
  sandboxId: 'sbx_expired',
  codeServerPid: 1234,
  host: '18080-sbx_expired.e2b.app',
  trafficAccessToken: 'secret-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2026-05-29T10:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

describe('cleanupExpiredIdeSessions', () => {
  it('stops expired running E2B IDE sessions and marks them stopped', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(expiredSession);
    await store.set({
      ...expiredSession,
      id: 'ide_future',
      sandboxId: 'sbx_future',
      expiresAt: '2099-05-29T10:00:00.000Z',
    });
    const stopCodeServer = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupExpiredIdeSessions({
      sessionStore: store,
      e2bProvider: { stopCodeServer },
      now: new Date('2026-05-30T00:00:00.000Z'),
    });

    expect(result).toEqual({
      scanned: 1,
      stopped: 1,
      failed: 0,
      failures: [],
    });
    expect(stopCodeServer).toHaveBeenCalledWith(expiredSession);
    await expect(store.get(expiredSession.id)).resolves.toEqual({
      ...expiredSession,
      status: 'stopped',
    });
  });

  it('reports cleanup failures without marking the session stopped', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(expiredSession);
    const stopCodeServer = vi.fn().mockRejectedValue(new Error('sandbox unavailable'));

    const result = await cleanupExpiredIdeSessions({
      sessionStore: store,
      e2bProvider: { stopCodeServer },
      now: new Date('2026-05-30T00:00:00.000Z'),
    });

    expect(result).toEqual({
      scanned: 1,
      stopped: 0,
      failed: 1,
      failures: [{
        sessionId: expiredSession.id,
        sandboxId: expiredSession.sandboxId,
        error: 'sandbox unavailable',
      }],
    });
    await expect(store.get(expiredSession.id)).resolves.toEqual(expiredSession);
  });
});
