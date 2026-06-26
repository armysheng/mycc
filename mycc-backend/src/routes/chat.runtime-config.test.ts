import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestUserLookup } from '../test/auth-mocks.js';
import { chatRoutes } from './chat.js';

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

async function buildApp(options: Parameters<typeof chatRoutes>[1]) {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes, options);
  return app;
}

describe('chat runtime config route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserById.mockImplementation(makeTestUserLookup());
  });

  it('requires auth before exposing runtime metadata', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/runtime/config',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '请先登录后再继续。' });
    await app.close();
  });

  it('returns safe runtime and direct MyCC Claude provider metadata for authenticated users', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
        MYCC_CLAUDE_BASE_URL: 'https://zhuji.example.test/v1',
        MYCC_CLAUDE_AUTH_TOKEN: 'zhuji-secret',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/runtime/config',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        kind: 'e2b-claude-agent-sdk',
        executionEnvironment: 'e2b',
        usesAgentSdk: true,
        usesCodeServerWorkspace: true,
        claudeProvider: {
          provider: 'mycc-claude',
          baseUrlConfigured: true,
          baseUrlSource: 'MYCC_CLAUDE_BASE_URL',
          credentialConfigured: true,
          credentialSource: 'MYCC_CLAUDE_AUTH_TOKEN',
          credentialTarget: 'ANTHROPIC_AUTH_TOKEN',
        },
        e2bAgentPreflight: {
          ok: false,
          errorCount: 1,
          warnCount: 2,
          skipCount: 1,
          checks: expect.arrayContaining([
            expect.objectContaining({
              id: 'e2b-api-key',
              status: 'error',
              label: 'E2B API key',
            }),
            expect.objectContaining({
              id: 'agent-runtime',
              status: 'ok',
            }),
            expect.objectContaining({
              id: 'ide-provider',
              status: 'warn',
            }),
          ]),
        },
      },
    });
    expect(response.body).not.toContain('ccr-secret');
    expect(response.body).not.toContain('ccr.example.test');
    expect(response.body).not.toContain('zhuji-secret');
    expect(response.body).not.toContain('zhuji.example.test');
    await app.close();
  });

  it('does not leak E2B keys or provider URLs in runtime preflight metadata', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_E2B_API_KEY: 'e2b_liveKey-ABC_123',
        MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
        MYCC_CCR_AUTH_TOKEN: 'ccr-secret',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/runtime/config',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.e2bAgentPreflight).toEqual(expect.objectContaining({
      ok: false,
      errorCount: 0,
      warnCount: 0,
      skipCount: 1,
    }));
    expect(response.body).not.toContain('e2b_liveKey-ABC_123');
    expect(response.body).not.toContain('ccr-secret');
    expect(response.body).not.toContain('ccr.example.test');
    await app.close();
  });
});
