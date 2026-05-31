import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRoutes } from './chat.js';
import { InMemoryIdeSessionStore } from '../ide/session-store.js';
import {
  __resetOnboardingBootstrapTicketStoreForTests,
  issueOnboardingBootstrapTicket,
} from '../onboarding/bootstrap-ticket-store.js';

const mocks = vi.hoisted(() => ({
  appendConversationMessages: vi.fn(),
  checkQuota: vi.fn(),
  createAgentRuntime: vi.fn(),
  findUserById: vi.fn(),
  getConversationMessageSnapshots: vi.fn(),
  getSSHPool: vi.fn(),
  logUsage: vi.fn(),
  markUserInitialized: vi.fn(),
  renameConversation: vi.fn(),
  runtimeChat: vi.fn(),
  updateConversationStats: vi.fn(),
  upsertConversation: vi.fn(),
  userOwnsConversation: vi.fn(),
}));

vi.mock('../agent-runtime/index.js', () => ({
  createAgentRuntime: mocks.createAgentRuntime,
}));

vi.mock('../ssh/pool.js', () => ({
  getSSHPool: mocks.getSSHPool,
}));

vi.mock('../db/client.js', () => ({
  appendConversationMessages: mocks.appendConversationMessages,
  checkQuota: mocks.checkQuota,
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
  getConversationMessageSnapshots: mocks.getConversationMessageSnapshots,
  getSubscription: vi.fn(),
  getUserConversations: vi.fn(),
  logUsage: mocks.logUsage,
  markUserInitialized: mocks.markUserInitialized,
  renameConversation: mocks.renameConversation,
  updateConversationStats: mocks.updateConversationStats,
  updateUserProfile: vi.fn(),
  upsertConversation: mocks.upsertConversation,
  userOwnsConversation: mocks.userOwnsConversation,
}));

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(overrides: Partial<{ userId: number; linuxUser: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: overrides.linuxUser ?? 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: Parameters<typeof chatRoutes>[1]) {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes, options);
  return app;
}

describe('chat E2B project context injection', () => {
  beforeEach(() => {
    __resetOnboardingBootstrapTicketStoreForTests();
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'e2b-claude-cli');
    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.findUserById.mockResolvedValue(null);
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH 连接池未初始化，请先调用 initSSHPool()');
    });
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.markUserInitialized.mockResolvedValue(undefined);
    mocks.renameConversation.mockResolvedValue(true);
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'session-e2b-context',
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates the E2B IDE session and injects about-me context before runtime chat', async () => {
    const sessionStore = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_context',
      codeServerPid: 4321,
      host: '18080-sbx_context.e2b.app',
      trafficAccessToken: 'traffic-secret',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: 'README.md',
          path: '/home/mycc/workspace/0-System/about-me/README.md',
          content: 'hello from e2b about-me',
          missing: false,
        },
      ]),
      stderr: '',
    });
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: 'system',
        session_id: 'session-e2b-context',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
      };
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-cli',
        MYCC_IDE_PROVIDER: 'e2b',
      },
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: sessionStore,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: authHeader() },
      payload: { message: '请总结当前项目' },
    });

    expect(response.statusCode).toBe(200);
    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(runCommandInSession).toHaveBeenCalledOnce();
    expect(mocks.runtimeChat).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('hello from e2b about-me'),
    }));
    const runtimeMessage = mocks.runtimeChat.mock.calls[0]![0].message as string;
    expect(runtimeMessage).toContain('# Project Context');
    expect(runtimeMessage).toContain('## User Request\n请总结当前项目');
    expect(mocks.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-e2b-context',
      title: '请总结当前项目',
      userId: 42,
    }));
    await app.close();
  });

  it('passes the requested permission mode through to the agent runtime', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: authHeader() },
      payload: {
        message: '先规划一下',
        permissionMode: 'plan',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runtimeChat).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'plan',
    }));
    const runtimeMessage = mocks.runtimeChat.mock.calls[0]![0].message as string;
    expect(runtimeMessage).toContain('.mycc/deliverables.json');
    expect(runtimeMessage).toContain('## User Request\n先规划一下');
    await app.close();
  });

  it('does not wrap runtime control messages while resuming a session', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: authHeader() },
      payload: {
        message: 'continue',
        sessionId: 'session-existing',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runtimeChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'continue',
      sessionId: 'session-existing',
    }));
    await app.close();
  });

  it('verifies onboarding bootstrap in the E2B sandbox without using SSH', async () => {
    const ticket = issueOnboardingBootstrapTicket({
      userId: 42,
      assistantName: '小满',
      ownerName: '大辉',
    });
    const bootstrapMessage = [
      '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
      '2. 按以下信息个性化初始化：',
      `   - 初始化票据：${ticket.token}`,
      '   - 助手名称：小满',
      '   - 用户称呼：大辉',
    ].join('\n');
    const sessionStore = new InMemoryIdeSessionStore();
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_bootstrap',
      codeServerPid: 4321,
      host: '18080-sbx_bootstrap.e2b.app',
      trafficAccessToken: 'traffic-secret',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true }),
      stderr: '',
    });
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: 'system',
        session_id: 'session-e2b-context',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
      };
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
      },
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: sessionStore,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: authHeader() },
      payload: { message: bootstrapMessage },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"type":"done"');
    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx_bootstrap', userId: 42 }),
      expect.stringContaining('IDENTITY.md'),
      {
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      },
    );
    expect(mocks.getSSHPool).not.toHaveBeenCalled();
    expect(mocks.markUserInitialized).toHaveBeenCalledWith({
      userId: 42,
      assistantName: '小满',
    });
    expect(mocks.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-e2b-context',
      title: undefined,
      userId: 42,
    }));
    expect(JSON.stringify(mocks.upsertConversation.mock.calls)).not.toContain('首次初始化');
    await app.close();
  });

  it('stores a product-side message snapshot after a successful chat turn', async () => {
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: 'system',
        session_id: 'session-snapshot',
      };
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: '我已经整理好当前项目状态。',
            },
          ],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
      };
    });
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: authHeader() },
      payload: { message: '帮我整理项目状态' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.appendConversationMessages).toHaveBeenCalledWith({
      userId: 42,
      sessionId: 'session-snapshot',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: '帮我整理项目状态',
          createdAt: expect.any(Date),
        }),
        expect.objectContaining({
          role: 'assistant',
          content: '我已经整理好当前项目状态。',
          createdAt: expect.any(Date),
        }),
      ],
    });
    await app.close();
  });
});
