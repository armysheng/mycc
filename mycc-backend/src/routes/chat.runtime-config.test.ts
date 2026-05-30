import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { chatRoutes } from './chat.js';

vi.mock('../db/client.js', () => ({
  checkQuota: vi.fn(),
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: vi.fn(),
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
    expect(response.json()).toEqual({ error: '未提供认证 token' });
    await app.close();
  });

  it('returns safe runtime and CCR readiness metadata for authenticated users', async () => {
    const app = await buildApp({
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
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
    expect(response.json()).toEqual({
      success: true,
      data: {
        kind: 'e2b-claude-agent-sdk',
        executionEnvironment: 'e2b',
        usesAgentSdk: true,
        usesCodeServerWorkspace: true,
        claudeProvider: {
          provider: 'ccr',
          baseUrlConfigured: true,
          baseUrlSource: 'MYCC_CCR_BASE_URL',
          credentialConfigured: true,
          credentialSource: 'MYCC_CCR_AUTH_TOKEN',
          credentialTarget: 'ANTHROPIC_AUTH_TOKEN',
        },
      },
    });
    expect(response.body).not.toContain('ccr-secret');
    expect(response.body).not.toContain('ccr.example.test');
    await app.close();
  });
});
