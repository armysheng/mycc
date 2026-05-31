import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from './chat.js';

const mocks = vi.hoisted(() => ({
  appendConversationMessages: vi.fn(),
  findUserById: vi.fn(),
  getConversationMessageSnapshots: vi.fn(),
  getSSHPool: vi.fn(),
  userOwnsConversation: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  appendConversationMessages: mocks.appendConversationMessages,
  checkQuota: vi.fn(),
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
  getConversationMessageSnapshots: mocks.getConversationMessageSnapshots,
  getSubscription: vi.fn(),
  getUserConversations: vi.fn(),
  logUsage: vi.fn(),
  markUserInitialized: vi.fn(),
  pool: { query: vi.fn() },
  renameConversation: vi.fn(),
  updateConversationStats: vi.fn(),
  updateUserProfile: vi.fn(),
  upsertConversation: vi.fn(),
  userOwnsConversation: mocks.userOwnsConversation,
}));

vi.mock('../ssh/pool.js', () => ({
  getSSHPool: mocks.getSSHPool,
}));

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(): string {
  const token = jwt.sign({
    userId: 42,
    linuxUser: 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: Parameters<typeof chatRoutes>[1] = {}) {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes, options);
  return app;
}

describe('chat history route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
  });

  it('filters hidden bootstrap and init records from session history', async () => {
    const connection = { id: 'ssh-connection' };
    const historyLines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        timestamp: '2026-05-31T00:00:00.000Z',
        session_id: 'session_123',
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-31T00:00:01.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-31T00:00:02.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: '我已经整理好当前项目状态。',
            },
          ],
        },
      }),
    ].join('\n');
    mocks.userOwnsConversation.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({
      id: 42,
      linux_user: 'tester',
    });
    mocks.getSSHPool.mockReturnValue({
      acquire: vi.fn().mockResolvedValue(connection),
      exec: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: historyLines,
        stderr: '',
      }),
      release: vi.fn(),
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/session_123/messages',
      headers: { authorization: authHeader() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        sessionId: 'session_123',
        messages: [
          expect.objectContaining({
            type: 'assistant',
            timestamp: '2026-05-31T00:00:02.000Z',
          }),
        ],
        total: 1,
      },
    });
    expect(response.body).not.toContain('首次初始化');
    expect(response.body).not.toContain('"type":"system"');
    await app.close();
  });

  it('loads session history from the running E2B workbench without touching SSH', async () => {
    const historyLines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-31T00:00:01.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: '帮我整理项目状态',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-31T00:00:02.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: '我已经整理好当前项目状态。',
            },
          ],
        },
      }),
    ].join('\n');
    const session = {
      id: 'ide_123',
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-31T00:00:00.000Z',
      proxyToken: 'proxy-token',
      userId: 42,
      status: 'running',
    };
    const ideSessionStore = {
      get: vi.fn(),
      set: vi.fn(),
      findReusableByUser: vi.fn().mockResolvedValue(session),
      findExpiredRunning: vi.fn(),
    };
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: historyLines,
      stderr: '',
    });
    mocks.userOwnsConversation.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({
      id: 42,
      linux_user: 'tester',
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH should not be used for E2B history loading');
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      },
      ideSessionStore,
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/session_123/messages',
      headers: { authorization: authHeader() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        sessionId: 'session_123',
        messages: [
          expect.objectContaining({ type: 'user' }),
          expect.objectContaining({ type: 'assistant' }),
        ],
        total: 2,
      },
    });
    expect(runCommandInSession).toHaveBeenCalledWith(
      session,
      expect.stringContaining('/home/mycc/.claude/projects/-home-mycc-workspace/session_123.jsonl'),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      }),
    );
    expect(mocks.getSSHPool).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns an empty old conversation instead of 500 when E2B history reading fails', async () => {
    const session = {
      id: 'ide_123',
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-31T00:00:00.000Z',
      proxyToken: 'proxy-token',
      userId: 42,
      status: 'running',
    };
    const ideSessionStore = {
      get: vi.fn(),
      set: vi.fn(),
      findReusableByUser: vi.fn().mockResolvedValue(session),
      findExpiredRunning: vi.fn(),
    };
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'history workspace is unavailable',
    });
    mocks.userOwnsConversation.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({
      id: 42,
      linux_user: 'tester',
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH should not be used for E2B history loading');
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      },
      ideSessionStore,
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/session_123/messages',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        sessionId: 'session_123',
        messages: [],
        total: 0,
      },
    });
    await app.close();
  });

  it('falls back to product-side message snapshots when runtime history is unavailable', async () => {
    const session = {
      id: 'ide_123',
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-31T00:00:00.000Z',
      proxyToken: 'proxy-token',
      userId: 42,
      status: 'running',
    };
    const ideSessionStore = {
      get: vi.fn(),
      set: vi.fn(),
      findReusableByUser: vi.fn().mockResolvedValue(session),
      findExpiredRunning: vi.fn(),
    };
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'history workspace is unavailable',
    });
    mocks.getConversationMessageSnapshots.mockResolvedValue([
      {
        role: 'user',
        content: '帮我整理项目状态',
        createdAt: new Date('2026-05-31T01:00:00.000Z'),
      },
      {
        role: 'assistant',
        content: '我已经整理好当前项目状态。',
        createdAt: new Date('2026-05-31T01:00:02.000Z'),
      },
    ]);
    mocks.userOwnsConversation.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({
      id: 42,
      linux_user: 'tester',
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH should not be used for E2B history loading');
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      },
      ideSessionStore,
      e2bProvider: { runCommandInSession },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/session_123/messages',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getConversationMessageSnapshots).toHaveBeenCalledWith(
      42,
      'session_123',
      200,
    );
    expect(response.json()).toEqual({
      success: true,
      data: {
        sessionId: 'session_123',
        messages: [
          expect.objectContaining({
            type: 'user',
            timestamp: '2026-05-31T01:00:00.000Z',
            message: expect.objectContaining({
              content: [expect.objectContaining({ text: '帮我整理项目状态' })],
            }),
          }),
          expect.objectContaining({
            type: 'assistant',
            timestamp: '2026-05-31T01:00:02.000Z',
            message: expect.objectContaining({
              content: [expect.objectContaining({ text: '我已经整理好当前项目状态。' })],
            }),
          }),
        ],
        total: 2,
      },
    });
    await app.close();
  });

  it('returns an empty old conversation instead of 500 when the history workspace lookup fails', async () => {
    const ideSessionStore = {
      get: vi.fn(),
      set: vi.fn(),
      findReusableByUser: vi.fn().mockRejectedValue(new Error('history workspace lookup failed')),
      findExpiredRunning: vi.fn(),
    };
    mocks.userOwnsConversation.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({
      id: 42,
      linux_user: 'tester',
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH should not be used for E2B history loading');
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-assistant-sandbox-dev',
      },
      ideSessionStore,
      e2bProvider: { runCommandInSession: vi.fn() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/session_123/messages',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        sessionId: 'session_123',
        messages: [],
        total: 0,
      },
    });
    await app.close();
  });
});
