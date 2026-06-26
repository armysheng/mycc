import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isWorkspaceExecEnabled,
  normalizeWorkspacePath,
  resolveWorkspaceProviderKind,
  workspaceRoutes,
  type WorkspaceRoutesOptions,
} from './workspace.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { makeTestUserLookup } from '../test/auth-mocks.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  appendConversationMessages: vi.fn(),
  checkQuota: vi.fn(),
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
  getConversationMessageSnapshots: vi.fn(),
  getSubscription: vi.fn(),
  getUserConversations: vi.fn(),
  logUsage: vi.fn(),
  markUserInitialized: vi.fn(),
  pool: { query: vi.fn() },
  renameConversation: vi.fn(),
  updateConversationStats: vi.fn(),
  updateUserProfile: vi.fn(),
  upsertConversation: vi.fn(),
  userOwnsConversation: vi.fn(),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserById.mockImplementation(makeTestUserLookup());
  });

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

  it('uses the requested owned E2B IDE session for workspace reads', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    const requestedSession: StoredIdeSession = {
      ...runningSession,
      id: 'ide_requested',
      sandboxId: 'sbx_requested',
      host: '18080-sbx_requested.e2b.app',
    };
    const latestSession: StoredIdeSession = {
      ...runningSession,
      id: 'ide_latest',
      sandboxId: 'sbx_latest',
      host: '18080-sbx_latest.e2b.app',
    };
    await sessionStore.set(requestedSession);
    await sessionStore.set(latestSession);
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        tree: {
          id: '/',
          name: 'workspace',
          path: '/',
          type: 'directory',
          size: 0,
          mtime: '2026-05-30T00:00:00.000Z',
          children: [],
        },
        truncated: false,
        nodeCount: 1,
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
      url: '/api/workspace/tree?path=/&ideSessionId=ide_requested',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(runCommandInSession).toHaveBeenCalledWith(
      requestedSession,
      expect.stringContaining("node -e '"),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      }),
    );
  });

  it('rejects workspace reads for another user E2B IDE session', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set({ ...runningSession, userId: 7 });
    const runCommandInSession = vi.fn();
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
      url: '/api/workspace/tree?ideSessionId=ide_123',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      error: '需要先打开工作间',
      code: 'workbench_required',
    });
    expect(runCommandInSession).not.toHaveBeenCalled();
    expect(response.body).not.toMatch(/sbx_123|traffic-token|proxy-token|E2B|sandbox|session/i);
  });

  it('serves safe workspace previews without exposing provider details', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        path: '/reports/preview.html',
        size: 42,
        mtime: '2026-05-31T12:00:00.000Z',
        mimeType: 'text/html',
        previewType: 'html',
        truncated: false,
        supported: true,
        content: '<h1>Preview</h1>',
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
      url: '/api/workspace/preview?path=/reports/preview.html',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        path: '/reports/preview.html',
        size: 42,
        mtime: '2026-05-31T12:00:00.000Z',
        mimeType: 'text/html',
        previewType: 'html',
        truncated: false,
        supported: true,
        content: '<h1>Preview</h1>',
      },
    });
    expect(response.body).not.toMatch(/traffic-token|proxy-token|sbx_123|e2b\.app/i);
    expect(runCommandInSession).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining("node -e '"),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      }),
    );
  });

  it('rejects secret-looking workspace preview paths before running remote commands', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const runCommandInSession = vi.fn();
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
      url: '/api/workspace/preview?path=/.env',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: '该文件不适合预览',
    });
    expect(runCommandInSession).not.toHaveBeenCalled();
  });

  it('rejects secret-looking workspace preview directories before running remote commands', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const runCommandInSession = vi.fn();
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
      url: '/api/workspace/preview?path=/reports/secrets/preview.html',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: '该文件不适合预览',
    });
    expect(runCommandInSession).not.toHaveBeenCalled();
  });

  it('rejects traversal preview paths before running remote commands', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const runCommandInSession = vi.fn();
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
      url: '/api/workspace/preview?path=/../../etc/passwd',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: '非法路径',
    });
    expect(runCommandInSession).not.toHaveBeenCalled();
  });

  it('returns a safe preview error when files exceed the 2MB preview limit', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: sessionStore,
      e2bProvider: {
        runCommandInSession: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'preview-too-large E2B sbx_123 traffic-token proxy-token session provider',
        }),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/preview?path=/reports/big.html',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: '文件过大，暂不支持预览',
    });
    expect(response.body).not.toMatch(/traffic-token|proxy-token|sbx_123|E2B|session|provider/i);
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
      error: '需要先打开工作间',
      code: 'workbench_required',
    });
    expect(response.body).not.toMatch(/code-server|Remote IDE|代码编辑器|needs_workspace|E2B|sandbox|沙盒/i);
  });

  it('marks stale E2B workspace sessions stopped when sandbox command fails', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: sessionStore,
      e2bProvider: {
        runCommandInSession: vi.fn().mockRejectedValue(new Error('sandbox not found')),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/tree',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      error: '工作间已过期，请重新打开工作间',
      code: 'workbench_stale',
    });
    expect(await sessionStore.findReusableByUser(42)).toBeNull();
    expect(await sessionStore.get(runningSession.id)).toEqual({
      ...runningSession,
      status: 'stopped',
    });
  });

  it('does not stop E2B workspace sessions for generic command errors', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: sessionStore,
      e2bProvider: {
        runCommandInSession: vi.fn().mockRejectedValue(new Error('command timed out')),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/tree',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: '工作区暂不可用，请稍后重试',
      code: 'workspace_unavailable',
    });
    expect(await sessionStore.findReusableByUser(42)).toEqual(runningSession);
  });

  it('does not expose low-level command stderr in workspace API errors', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    await sessionStore.set(runningSession);
    const app = await buildApp({
      env: {
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      ideSessionStore: sessionStore,
      e2bProvider: {
        runCommandInSession: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'column "desktop_pid" does not exist',
        }),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/workspace/tree',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: '工作区暂不可用，请稍后重试',
      code: 'workspace_unavailable',
    });
    expect(response.body).not.toMatch(/desktop_pid|column|does not exist|E2B|Remote IDE/);
  });
});
