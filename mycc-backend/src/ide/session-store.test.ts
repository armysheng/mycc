import { describe, expect, it, vi } from 'vitest';
import { InMemoryIdeSessionStore, PostgresIdeSessionStore, type StoredIdeSession } from './session-store.js';

const baseSession: StoredIdeSession = {
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

describe('IDE session stores', () => {
  it('keeps sessions in memory for tests and local injection', async () => {
    const store = new InMemoryIdeSessionStore();

    await store.set(baseSession);

    await expect(store.get(baseSession.id)).resolves.toEqual(baseSession);
    await expect(store.findReusableByUser(baseSession.userId)).resolves.toEqual(baseSession);
  });

  it('persists and reloads IDE sessions through Postgres', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 'ide_123',
          user_id: 42,
          provider: 'e2b',
          sandbox_id: 'sbx_123',
          code_server_pid: 1234,
          host: '18080-sbx_123.e2b.app',
          traffic_access_token: 'secret-token',
          port: 18080,
          access_mode: 'mycc-proxy',
          status: 'running',
          proxy_token: 'proxy-token',
          expires_at: new Date('2099-05-29T14:00:00.000Z'),
          stopped_at: null,
        }],
      });
    const store = new PostgresIdeSessionStore({ query });

    await store.set(baseSession);
    const reloaded = await store.get(baseSession.id);

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO ide_sessions'), [
      'ide_123',
      42,
      'e2b',
      'sbx_123',
      1234,
      '18080-sbx_123.e2b.app',
      'secret-token',
      18080,
      'mycc-proxy',
      'running',
      'proxy-token',
      '2099-05-29T14:00:00.000Z',
      null,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('SELECT'), ['ide_123']);
    expect(reloaded).toEqual(baseSession);
  });

  it('loads reusable running IDE sessions for a user from Postgres', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{
        id: 'ide_123',
        user_id: 42,
        provider: 'e2b',
        sandbox_id: 'sbx_123',
        code_server_pid: 1234,
        host: '18080-sbx_123.e2b.app',
        traffic_access_token: 'secret-token',
        port: 18080,
        access_mode: 'mycc-proxy',
        status: 'running',
        proxy_token: 'proxy-token',
        expires_at: new Date('2099-05-29T14:00:00.000Z'),
        stopped_at: null,
      }],
    });
    const store = new PostgresIdeSessionStore({ query });

    const reloaded = await store.findReusableByUser(42);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('status = $2'), [42, 'running']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('expires_at > NOW()'), [42, 'running']);
    expect(reloaded).toEqual(baseSession);
  });
});
