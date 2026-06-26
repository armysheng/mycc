import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestUserLookup } from '../test/auth-mocks.js';
import { chatRoutes } from './chat.js';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  getUserConversations: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  appendConversationMessages: vi.fn(),
  checkQuota: vi.fn(),
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
  getConversationMessageSnapshots: vi.fn(),
  getSubscription: vi.fn(),
  getUserConversations: mocks.getUserConversations,
  logUsage: vi.fn(),
  markUserInitialized: vi.fn(),
  pool: { query: vi.fn() },
  renameConversation: vi.fn(),
  updateConversationStats: vi.fn(),
  updateUserProfile: vi.fn(),
  upsertConversation: vi.fn(),
  userOwnsConversation: vi.fn(),
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

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes);
  return app;
}

describe('chat sessions route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserById.mockImplementation(makeTestUserLookup());
  });

  it('filters control and bootstrap conversations out of the session list', async () => {
    mocks.getUserConversations.mockResolvedValue([
      {
        sessionId: 'session_bootstrap',
        title: '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
        messageCount: 1,
        totalTokens: 800,
        createdAt: new Date('2026-05-30T08:00:00.000Z'),
        updatedAt: new Date('2026-05-30T08:00:00.000Z'),
      },
      {
        sessionId: 'session_accept',
        title: 'accept',
        messageCount: 1,
        totalTokens: 20,
        createdAt: new Date('2026-05-30T09:00:00.000Z'),
        updatedAt: new Date('2026-05-30T09:00:00.000Z'),
      },
      {
        sessionId: 'session_init_failed',
        title: '初始化流程执行失败：BOOTSTRAP.md 未归档',
        messageCount: 2,
        totalTokens: 300,
        createdAt: new Date('2026-05-30T09:30:00.000Z'),
        updatedAt: new Date('2026-05-30T09:30:00.000Z'),
      },
      {
        sessionId: 'session_user_task',
        title: '整理当前项目状态',
        messageCount: 6,
        totalTokens: 1200,
        createdAt: new Date('2026-05-30T10:00:00.000Z'),
        updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      },
    ]);
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        conversations: [
          expect.objectContaining({
            sessionId: 'session_user_task',
            title: '整理当前项目状态',
          }),
        ],
        total: 1,
        hasMore: false,
      },
    });
    expect(response.body).not.toContain('首次初始化');
    expect(response.body).not.toContain('accept');
    expect(response.body).not.toContain('BOOTSTRAP.md');
    await app.close();
  });
});
