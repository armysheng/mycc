import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { chatRoutes } from './chat.js';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  getSSHPool: vi.fn(),
  userOwnsConversation: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  checkQuota: vi.fn(),
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
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

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes);
  return app;
}

describe('chat history route', () => {
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
});
