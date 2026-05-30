import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { assistantRoutes, type AssistantRoutesOptions } from './assistant.js';

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_secret_123',
  codeServerPid: 1234,
  host: '18080-sbx-secret.e2b.app',
  trafficAccessToken: 'e2b_live_secret_123456',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token-secret',
  userId: 42,
  status: 'running',
};

function authHeader(): string {
  const token = jwt.sign({
    userId: 42,
    linuxUser: 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp(options: AssistantRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(assistantRoutes, options);
  return app;
}

function defaultOptions(): AssistantRoutesOptions {
  const sessionStore = new InMemoryIdeSessionStore();
  return {
    sessionStore,
    getUserConversations: vi.fn().mockResolvedValue([
      {
        sessionId: 'session_abc',
        title: '调研 Claude Code UI',
        messageCount: 6,
        totalTokens: 1200,
        createdAt: new Date('2026-05-29T10:00:00.000Z'),
        updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      },
    ]),
    findUserById: vi.fn().mockResolvedValue({
      id: 42,
      email: 'tester@example.com',
      password_hash: 'hash',
      assistant_name: '小麦',
      linux_user: 'tester',
      status: 'active',
      is_initialized: true,
      created_at: new Date('2026-05-01T00:00:00.000Z'),
      updated_at: new Date('2026-05-30T00:00:00.000Z'),
    }),
  };
}

async function buildAppWithRunningSession() {
  const options = defaultOptions();
  await options.sessionStore!.set(runningSession);
  return buildApp(options);
}

describe('assistant routes', () => {
  it('requires auth for assistant home', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '未提供认证 token' });
    await app.close();
  });

  it('maps conversations to recent task-like cards without durable task states', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/home',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tasks[0]).toMatchObject({
      id: 'session_abc',
      source: 'conversation',
      status: 'recent',
      title: '调研 Claude Code UI',
      messageCount: 6,
    });
    expect(body.data.tasks[0].status).not.toMatch(/blocked|completed|failed|verified/);
    await app.close();
  });

  it('labels memory sources separately', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/memory',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.sources.map((source: { kind: string }) => source.kind)).toEqual([
      'profile',
      'project_context',
      'runtime_memory',
    ]);
    await app.close();
  });

  it('returns instructional deliverable empty state before artifact registry exists', async () => {
    const app = await buildApp(defaultOptions());

    const response = await app.inject({
      method: 'GET',
      url: '/api/assistant/deliverables',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        deliverables: [],
        emptyState: expect.objectContaining({
          title: '还没有制品',
        }),
      },
    });
    await app.close();
  });

  it('does not leak provider, runtime, or secret fields from any assistant endpoint', async () => {
    const app = await buildAppWithRunningSession();

    for (const url of ['/api/assistant/home', '/api/assistant/memory', '/api/assistant/deliverables']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: authHeader() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('trafficAccessToken');
      expect(response.body).not.toContain('proxyToken');
      expect(response.body).not.toContain('e2b_live_secret_123456');
      expect(response.body).not.toContain('e2b-traffic-access-token');
      expect(response.body).not.toMatch(/[a-z0-9-]+\.e2b\.app/i);
      expect(response.body).not.toContain('https://provider.example.com/secret-route');
      expect(response.body).not.toContain('sk-provider-secret');
      expect(response.body).not.toContain('sbx_secret_123');
      expect(response.body).not.toContain('"provider"');
      expect(response.body).not.toMatch(/\be2b\b/i);
      expect(response.body).not.toMatch(/\bsandbox\b/i);
    }

    await app.close();
  });
});
