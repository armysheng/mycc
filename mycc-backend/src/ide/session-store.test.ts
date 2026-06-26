import { describe, expect, it, vi } from 'vitest';
import { InMemoryIdeSessionStore, PostgresIdeSessionStore, type StoredIdeSession } from './session-store.js';

const baseSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  template: 'mycc-assistant-sandbox-dev',
  linuxUser: 'mycc',
  workspaceDir: '/home/mycc/workspace',
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

const desktopSession: StoredIdeSession = {
  ...baseSession,
  desktopPid: 4321,
  desktopHost: '16080-sbx_123.e2b.app',
  desktopPort: 16080,
};

const expiredSession: StoredIdeSession = {
  ...baseSession,
  id: 'ide_expired',
  sandboxId: 'sbx_expired',
  host: '18080-sbx_expired.e2b.app',
  expiresAt: '2026-05-29T10:00:00.000Z',
};

describe('IDE session stores', () => {
  it('keeps sessions in memory for tests and local injection', async () => {
    const store = new InMemoryIdeSessionStore();

    await store.set(baseSession);

    await expect(store.get(baseSession.id)).resolves.toEqual(baseSession);
    await expect(store.findReusableByUser(baseSession.userId)).resolves.toEqual(baseSession);
  });

  it('lists expired running sessions from memory for cleanup', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(baseSession);
    await store.set(expiredSession);
    await store.set({ ...expiredSession, id: 'ide_stopped', status: 'stopped' });

    await expect(store.findExpiredRunning(new Date('2026-05-30T00:00:00.000Z'), 10))
      .resolves.toEqual([expiredSession]);
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
            template: 'mycc-assistant-sandbox-dev',
            linux_user: 'mycc',
            workspace_dir: '/home/mycc/workspace',
	          sandbox_id: 'sbx_123',
          code_server_pid: 1234,
          host: '18080-sbx_123.e2b.app',
          traffic_access_token: 'secret-token',
          port: 18080,
          desktop_pid: null,
          desktop_host: null,
          desktop_port: null,
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
        'mycc-assistant-sandbox-dev',
        'mycc',
        '/home/mycc/workspace',
	      'sbx_123',
      1234,
      '18080-sbx_123.e2b.app',
      'secret-token',
      18080,
      null,
      null,
      null,
      'mycc-proxy',
      'running',
      'proxy-token',
      '2099-05-29T14:00:00.000Z',
      null,
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('SELECT'), ['ide_123']);
    expect(reloaded).toEqual(baseSession);
  });

  it('persists optional desktop service details through Postgres', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
	          id: 'ide_123',
	          user_id: 42,
	          provider: 'e2b',
            template: 'mycc-assistant-sandbox-dev',
            linux_user: 'mycc',
            workspace_dir: '/home/mycc/workspace',
	          sandbox_id: 'sbx_123',
          code_server_pid: 1234,
          host: '18080-sbx_123.e2b.app',
          traffic_access_token: 'secret-token',
          port: 18080,
          desktop_pid: 4321,
          desktop_host: '16080-sbx_123.e2b.app',
          desktop_port: 16080,
          access_mode: 'mycc-proxy',
          status: 'running',
          proxy_token: 'proxy-token',
          expires_at: new Date('2099-05-29T14:00:00.000Z'),
          stopped_at: null,
        }],
      });
    const store = new PostgresIdeSessionStore({ query });

    await store.set(desktopSession);
    const reloaded = await store.get(desktopSession.id);

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('desktop_pid'), [
	      'ide_123',
	      42,
	      'e2b',
        'mycc-assistant-sandbox-dev',
        'mycc',
        '/home/mycc/workspace',
	      'sbx_123',
      1234,
      '18080-sbx_123.e2b.app',
      'secret-token',
      18080,
      4321,
      '16080-sbx_123.e2b.app',
      16080,
      'mycc-proxy',
      'running',
      'proxy-token',
      '2099-05-29T14:00:00.000Z',
      null,
    ]);
    expect(reloaded).toEqual(desktopSession);
  });

  it('loads reusable running IDE sessions for a user from Postgres', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{
        id: 'ide_123',
          user_id: 42,
          provider: 'e2b',
          template: 'mycc-assistant-sandbox-dev',
          linux_user: 'mycc',
          workspace_dir: '/home/mycc/workspace',
          sandbox_id: 'sbx_123',
        code_server_pid: 1234,
        host: '18080-sbx_123.e2b.app',
        traffic_access_token: 'secret-token',
        port: 18080,
        desktop_pid: null,
        desktop_host: null,
        desktop_port: null,
        access_mode: 'mycc-proxy',
        status: 'running',
        proxy_token: 'proxy-token',
        expires_at: new Date('2099-05-29T14:00:00.000Z'),
        stopped_at: null,
      }],
    });
    const store = new PostgresIdeSessionStore({ query });

    const reloaded = await store.findReusableByUser(42, {
      template: 'mycc-assistant-sandbox-dev',
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      port: 18080,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('template = $3'), [
      42,
      'running',
      'mycc-assistant-sandbox-dev',
      'mycc',
      '/home/mycc/workspace',
      18080,
    ]);
    expect(reloaded).toEqual(baseSession);
  });

  it('does not reuse an in-memory session with a different sandbox workspace identity', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(baseSession);

    await expect(store.findReusableByUser(42, {
      template: 'mycc-assistant-sandbox-dev',
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      port: 18080,
    })).resolves.toEqual(baseSession);
    await expect(store.findReusableByUser(42, {
      template: 'mycc-other-template',
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      port: 18080,
    })).resolves.toBeNull();
  });

  it('loads expired running IDE sessions for cleanup from Postgres', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{
        id: 'ide_expired',
          user_id: 42,
          provider: 'e2b',
          template: 'mycc-assistant-sandbox-dev',
          linux_user: 'mycc',
          workspace_dir: '/home/mycc/workspace',
          sandbox_id: 'sbx_expired',
        code_server_pid: 1234,
        host: '18080-sbx_expired.e2b.app',
        traffic_access_token: 'secret-token',
        port: 18080,
        desktop_pid: null,
        desktop_host: null,
        desktop_port: null,
        access_mode: 'mycc-proxy',
        status: 'running',
        proxy_token: 'proxy-token',
        expires_at: new Date('2026-05-29T10:00:00.000Z'),
        stopped_at: null,
      }],
    });
    const store = new PostgresIdeSessionStore({ query });
    const now = new Date('2026-05-30T00:00:00.000Z');

    const sessions = await store.findExpiredRunning(now, 25);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('expires_at <= $2::timestamptz'), [
      'running',
      '2026-05-30T00:00:00.000Z',
      25,
    ]);
    expect(sessions).toEqual([expiredSession]);
  });
});
