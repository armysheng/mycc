import { describe, expect, it, vi } from 'vitest';
import {
  renewIdeSessionsExpiringSoon,
  shouldStartIdeSessionKeepalive,
} from './session-keepalive.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from './session-store.js';

const baseSession: StoredIdeSession = {
  id: 'ide_soon',
  provider: 'e2b',
  template: 'mycc-assistant-sandbox-dev',
  linuxUser: 'mycc',
  workspaceDir: '/home/mycc/workspace',
  sandboxId: 'sbx_soon',
  codeServerPid: 1234,
  host: '18080-sbx_soon.e2b.app',
  trafficAccessToken: 'secret-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2026-06-05T00:20:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

describe('renewIdeSessionsExpiringSoon', () => {
  it('renews running user runners that are approaching their lease cutoff', async () => {
    const store = new InMemoryIdeSessionStore();
    const laterSession: StoredIdeSession = {
      ...baseSession,
      id: 'ide_later',
      sandboxId: 'sbx_later',
      expiresAt: '2026-06-06T12:00:00.000Z',
    };
    await store.set(baseSession);
    await store.set(laterSession);
    const renewCodeServer = vi.fn().mockImplementation(async (session: StoredIdeSession) => ({
      ...session,
      expiresAt: '2026-06-06T00:00:00.000Z',
    }));

    const result = await renewIdeSessionsExpiringSoon({
      sessionStore: store,
      e2bProvider: { renewCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
      now: new Date('2026-06-05T00:00:00.000Z'),
    });

    expect(result).toEqual({
      scanned: 1,
      renewed: 1,
      failed: 0,
      failures: [],
    });
    expect(renewCodeServer).toHaveBeenCalledWith(baseSession, 3600);
    expect(renewCodeServer).not.toHaveBeenCalledWith(laterSession, expect.anything());
    await expect(store.get(baseSession.id)).resolves.toEqual(expect.objectContaining({
      sandboxId: 'sbx_soon',
      expiresAt: '2026-06-06T00:00:00.000Z',
      status: 'running',
    }));
  });

  it('marks stale provider renew failures as stopped so they are not reused', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(baseSession);
    const renewCodeServer = vi.fn().mockRejectedValue(new Error('Paused sandbox sbx_soon not found'));

    const result = await renewIdeSessionsExpiringSoon({
      sessionStore: store,
      e2bProvider: { renewCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
      now: new Date('2026-06-05T00:00:00.000Z'),
    });

    expect(result).toEqual({
      scanned: 1,
      renewed: 0,
      failed: 1,
      failures: [{
        sessionId: 'ide_soon',
        sandboxId: 'sbx_soon',
        error: 'Paused sandbox sbx_soon not found',
      }],
    });
    await expect(store.get(baseSession.id)).resolves.toEqual(expect.objectContaining({
      id: baseSession.id,
      status: 'stopped',
    }));
  });

  it('does nothing when the IDE provider is disabled', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(baseSession);
    const renewCodeServer = vi.fn();

    const result = await renewIdeSessionsExpiringSoon({
      sessionStore: store,
      e2bProvider: { renewCodeServer },
      env: { MYCC_IDE_PROVIDER: 'disabled' },
      now: new Date('2026-06-05T00:00:00.000Z'),
    });

    expect(result).toEqual({
      scanned: 0,
      renewed: 0,
      failed: 0,
      failures: [],
    });
    expect(renewCodeServer).not.toHaveBeenCalled();
  });
});

describe('shouldStartIdeSessionKeepalive', () => {
  it('starts by default for the E2B provider unless explicitly disabled', () => {
    expect(shouldStartIdeSessionKeepalive({ MYCC_IDE_PROVIDER: 'e2b' })).toBe(true);
    expect(shouldStartIdeSessionKeepalive({
      MYCC_IDE_PROVIDER: 'e2b',
      MYCC_IDE_KEEPALIVE_ENABLED: 'false',
    })).toBe(false);
  });
});
