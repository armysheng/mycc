import { describe, expect, it, vi } from 'vitest';
import { ensureE2bIdeSession } from './e2b-session.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from './session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  template: 'mycc-assistant-sandbox-dev',
  linuxUser: 'mycc',
  workspaceDir: '/home/mycc/workspace',
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

  it('does not reuse a session from a different sandbox template or workspace identity', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set({
      ...runningSession,
      template: 'mycc-old-template',
    });
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_new_identity',
      codeServerPid: 4321,
      host: '18080-sbx_new_identity.e2b.app',
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

    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(session.sandboxId).toBe('sbx_new_identity');
  });

  it('renews a reusable session when the user runner lease is getting short', async () => {
    const store = new InMemoryIdeSessionStore();
    const expiringSession: StoredIdeSession = {
      ...runningSession,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    await store.set(expiringSession);
    const renewedSession: StoredIdeSession = {
      ...expiringSession,
      expiresAt: '2099-05-30T14:00:00.000Z',
    };
    const startCodeServer = vi.fn();
    const renewCodeServer = vi.fn().mockResolvedValue(renewedSession);

    const session = await ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer, renewCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    expect(renewCodeServer).toHaveBeenCalledWith(expiringSession, 3600);
    expect(startCodeServer).not.toHaveBeenCalled();
    expect(session).toEqual(expect.objectContaining({
      id: expiringSession.id,
      sandboxId: expiringSession.sandboxId,
      expiresAt: '2099-05-30T14:00:00.000Z',
      status: 'running',
    }));
    expect(await store.findReusableByUser(42)).toEqual(session);
  });

  it('keeps using the reusable session if lease renewal is temporarily unavailable', async () => {
    const store = new InMemoryIdeSessionStore();
    const expiringSession: StoredIdeSession = {
      ...runningSession,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    await store.set(expiringSession);
    const startCodeServer = vi.fn();
    const renewCodeServer = vi.fn().mockRejectedValue(new Error('renew unavailable'));

    const session = await ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer, renewCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    expect(renewCodeServer).toHaveBeenCalledOnce();
    expect(startCodeServer).not.toHaveBeenCalled();
    expect(session).toBe(expiringSession);
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
      template: 'mycc-assistant-sandbox-dev',
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      sandboxId: 'sbx_new',
      userId: 42,
      status: 'running',
      proxyToken: expect.any(String),
    }));
    expect(await store.findReusableByUser(42)).toEqual(session);
  });

  it('stops the sandbox when a new session cannot be persisted', async () => {
    const store = new InMemoryIdeSessionStore();
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('foreign key violation'));
    const started = {
      provider: 'e2b' as const,
      sandboxId: 'sbx_unpersisted',
      codeServerPid: 4321,
      host: '18080-sbx_unpersisted.e2b.app',
      trafficAccessToken: 'new-traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy' as const,
      expiresAt: '2099-05-29T14:00:00.000Z',
    };
    const startCodeServer = vi.fn().mockResolvedValue(started);
    const stopCodeServer = vi.fn().mockResolvedValue(undefined);
    const provider = { startCodeServer, stopCodeServer };

    await expect(ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: provider,
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    })).rejects.toThrow('foreign key violation');

    expect(stopCodeServer).toHaveBeenCalledWith(expect.objectContaining({
      sandboxId: 'sbx_unpersisted',
      codeServerPid: 4321,
    }));
  });

  it('seeds user Claude home separately from the workspace entry in a new E2B IDE session', async () => {
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
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'seeded',
      stderr: '',
    });

    const session = await ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer, runCommandInSession },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    expect(runCommandInSession).toHaveBeenCalledTimes(2);
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: 'sbx_new',
        userId: 42,
      }),
      expect.stringContaining('MYCC_CLAUDE_HOME_TEMPLATE_SEED'),
      expect.objectContaining({
        cwd: '/home/mycc/.claude',
        timeoutMs: 30000,
      }),
    );
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: 'sbx_new',
        userId: 42,
      }),
      expect.stringContaining('MYCC_WORKSPACE_TEMPLATE_SEED'),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      }),
    );
    const commands = runCommandInSession.mock.calls.map((call) => call[1] as string);
    const claudeHomeSeedCommand = commands.find((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))!;
    const workspaceSeedCommand = commands.find((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))!;
    expect(claudeHomeSeedCommand).toContain('CLAUDE.md');
    expect(claudeHomeSeedCommand).toContain('about-me/README.md');
    expect(claudeHomeSeedCommand).not.toContain('workspace/0-System/about-me');
    expect(workspaceSeedCommand).toContain('CLAUDE.md');
    expect(workspaceSeedCommand).not.toContain('0-System/about-me');
    expect(workspaceSeedCommand).not.toContain('MYCC_BOOTSTRAP_REQUIRED');
    expect(await store.findReusableByUser(42)).toEqual(session);
  });

  it('creates a new session when the caller already rejected the reusable session', async () => {
    const store = new InMemoryIdeSessionStore();
    await store.set(runningSession);
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_after_live_check',
      codeServerPid: 4321,
      host: '18080-sbx_after_live_check.e2b.app',
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
      skipReusable: true,
    });

    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(session).toEqual(expect.objectContaining({
      sandboxId: 'sbx_after_live_check',
      userId: 42,
      status: 'running',
    }));
  });

  it('coalesces concurrent session creation for the same user', async () => {
    const store = new InMemoryIdeSessionStore();
    let resolveStart: ((value: {
      provider: 'e2b';
      sandboxId: string;
      codeServerPid: number;
      host: string;
      trafficAccessToken: string;
      port: number;
      accessMode: 'mycc-proxy';
      expiresAt: string;
    }) => void) | undefined;
    const startCodeServer = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const first = ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });
    const second = ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: store,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startCodeServer).toHaveBeenCalledOnce();

    resolveStart?.({
      provider: 'e2b',
      sandboxId: 'sbx_singleflight',
      codeServerPid: 4321,
      host: '18080-sbx_singleflight.e2b.app',
      trafficAccessToken: 'singleflight-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const [firstSession, secondSession] = await Promise.all([first, second]);

    expect(firstSession).toEqual(secondSession);
    expect(await store.findReusableByUser(42)).toEqual(firstSession);
  });

  it('does not coalesce concurrent session creation for different workspace identities', async () => {
    const store = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockImplementation(async (plan) => ({
      provider: 'e2b',
      sandboxId: `sbx_${plan.template}`,
      codeServerPid: 4321,
      host: `18080-${plan.template}.e2b.app`,
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    }));

    const [first, second] = await Promise.all([
      ensureE2bIdeSession({
        userId: 42,
        linuxUser: 'tester',
        workspaceDir: '/home/tester/workspace',
        sessionStore: store,
        e2bProvider: { startCodeServer },
        env: { MYCC_IDE_PROVIDER: 'e2b', MYCC_E2B_TEMPLATE: 'template_a' },
      }),
      ensureE2bIdeSession({
        userId: 42,
        linuxUser: 'tester',
        workspaceDir: '/home/tester/workspace',
        sessionStore: store,
        e2bProvider: { startCodeServer },
        env: { MYCC_IDE_PROVIDER: 'e2b', MYCC_E2B_TEMPLATE: 'template_b' },
      }),
    ]);

    expect(startCodeServer).toHaveBeenCalledTimes(2);
    expect(first.template).toBe('template_a');
    expect(second.template).toBe('template_b');
  });

  it('coalesces concurrent session creation across store instances for the same user', async () => {
    const sessions = new Map<string, StoredIdeSession>();
    const firstStore = new InMemoryIdeSessionStore(sessions);
    const secondStore = new InMemoryIdeSessionStore(sessions);
    let resolveStart: ((value: {
      provider: 'e2b';
      sandboxId: string;
      codeServerPid: number;
      host: string;
      trafficAccessToken: string;
      port: number;
      accessMode: 'mycc-proxy';
      expiresAt: string;
    }) => void) | undefined;
    const startCodeServer = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const first = ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: firstStore,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });
    const second = ensureE2bIdeSession({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
      sessionStore: secondStore,
      e2bProvider: { startCodeServer },
      env: { MYCC_IDE_PROVIDER: 'e2b' },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startCodeServer).toHaveBeenCalledOnce();

    resolveStart?.({
      provider: 'e2b',
      sandboxId: 'sbx_shared_store_singleflight',
      codeServerPid: 4321,
      host: '18080-sbx_shared_store_singleflight.e2b.app',
      trafficAccessToken: 'shared-store-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const [firstSession, secondSession] = await Promise.all([first, second]);

    expect(firstSession).toEqual(secondSession);
    expect(await firstStore.findReusableByUser(42)).toEqual(firstSession);
    expect(await secondStore.findReusableByUser(42)).toEqual(firstSession);
  });
});
