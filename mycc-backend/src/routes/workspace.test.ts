import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isWorkspaceExecEnabled,
  normalizeWorkspacePath,
  resolveWorkspaceProviderKind,
  workspaceRoutes,
  type WorkspaceRoutesOptions,
} from './workspace.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

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

function authHeader(overrides: Partial<{ userId: number; linuxUser: string; role: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: overrides.linuxUser ?? 'tester',
    role: overrides.role ?? 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: WorkspaceRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(workspaceRoutes, options);
  return app;
}

describe('workspace route helpers', () => {
  afterEach(() => {
    delete process.env.WORKSPACE_EXEC_ENABLED;
  });

  it('normalizes root and nested paths', () => {
    expect(normalizeWorkspacePath('/')).toBe('.');
    expect(normalizeWorkspacePath('/src/app.ts')).toBe('src/app.ts');
    expect(normalizeWorkspacePath('src//nested/./a.ts')).toBe('src/nested/a.ts');
  });

  it('rejects traversal paths', () => {
    expect(() => normalizeWorkspacePath('../etc/passwd')).toThrow('非法路径');
    expect(() => normalizeWorkspacePath('/../../secret')).toThrow('非法路径');
  });

  it('disables exec endpoint by default', () => {
    expect(isWorkspaceExecEnabled()).toBe(false);
  });

  it('enables exec endpoint only when explicit true', () => {
    process.env.WORKSPACE_EXEC_ENABLED = 'true';
    expect(isWorkspaceExecEnabled()).toBe(true);

    process.env.WORKSPACE_EXEC_ENABLED = '1';
    expect(isWorkspaceExecEnabled()).toBe(false);
  });

  it('defaults workspace API to SSH and supports explicit E2B provider', () => {
    expect(resolveWorkspaceProviderKind({})).toBe('ssh');
    expect(resolveWorkspaceProviderKind({ MYCC_WORKSPACE_PROVIDER: 'e2b' })).toBe('e2b');
    expect(resolveWorkspaceProviderKind({ MYCC_WORKSPACE_PROVIDER: 'ssh' })).toBe('ssh');
    expect(() => resolveWorkspaceProviderKind({ MYCC_WORKSPACE_PROVIDER: 'local' }))
      .toThrow('Unsupported workspace provider: local');
  });

  it('runs workspace file reads inside a reusable E2B IDE sandbox when enabled', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        path: '/README.md',
        size: 12,
        mtime: '2026-05-30T00:00:00.000Z',
        truncated: false,
        binary: false,
        content: 'hello',
      }),
      stderr: '',
    });
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: sessionStore,
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/file?path=/README.md',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        path: '/README.md',
        size: 12,
        mtime: '2026-05-30T00:00:00.000Z',
        truncated: false,
        binary: false,
        content: 'hello',
      },
    });
    expect(runCommandInSession).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining("node -e '"),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      }),
    );
    const command = runCommandInSession.mock.calls[0]![1] as string;
    expect(command).not.toContain('sudo -n -u');
    expect(command).toContain('/home/mycc/workspace');
  });

  it('requires a running E2B IDE session before serving E2B workspace files', async () => {
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
      e2bProvider: { runCommandInSession: vi.fn() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/tree',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      error: 'E2B 工作区会话不存在，请先打开 Remote IDE',
    });
  });
});
