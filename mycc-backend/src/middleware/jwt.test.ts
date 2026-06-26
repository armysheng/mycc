import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findUserById } from '../db/client.js';
import { isAdminUser, jwtAuthMiddleware } from './jwt.js';

vi.mock('../db/client.js', () => ({
  findUserById: vi.fn(),
}));

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(overrides: Partial<{ userId: number; role: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: 'mycc_u42',
    role: overrides.role ?? 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/protected', { preHandler: jwtAuthMiddleware }, async (request) => ({
    userId: request.user?.userId,
    linuxUser: request.user?.linuxUser,
    role: request.user?.role,
  }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MYCC_ADMIN_USER_IDS;
  delete process.env.MYCC_ADMIN_EMAILS;
  delete process.env.MYCC_ADMIN_PHONES;
});

describe('jwtAuthMiddleware', () => {
  it('refreshes authenticated identity from the current active user record without trusting token role', async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: 42,
      phone: undefined,
      email: 'tester@example.test',
      password_hash: 'hash',
      assistant_name: '道友',
      linux_user: 'mycc_u42_current',
      status: 'active',
      is_initialized: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: authHeader({ role: 'admin' }) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userId: 42,
      linuxUser: 'mycc_u42_current',
      role: 'user',
    });
    await app.close();
  });

  it('uses the server-side admin allowlist as the role source', async () => {
    process.env.MYCC_ADMIN_USER_IDS = '42';
    vi.mocked(findUserById).mockResolvedValue({
      id: 42,
      phone: undefined,
      email: 'tester@example.test',
      password_hash: 'hash',
      assistant_name: '道友',
      linux_user: 'mycc_u42_current',
      status: 'active',
      is_initialized: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userId: 42,
      role: 'admin',
    });
    await app.close();
  });

  it('rejects tokens for deleted or disabled users', async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: 42,
      phone: undefined,
      email: 'tester@example.test',
      password_hash: 'hash',
      assistant_name: '道友',
      linux_user: 'mycc_u42',
      status: 'disabled',
      is_initialized: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: '账号不可用，请重新登录',
    });
    await app.close();
  });
});

describe('isAdminUser', () => {
  it('supports id, email, and phone allowlists', () => {
    const user = {
      id: 42,
      email: 'Admin@Example.TEST',
      phone: '+8613800138000',
    };

    expect(isAdminUser(user, { MYCC_ADMIN_USER_IDS: '42' })).toBe(true);
    expect(isAdminUser(user, { MYCC_ADMIN_EMAILS: 'admin@example.test' })).toBe(true);
    expect(isAdminUser(user, { MYCC_ADMIN_PHONES: '+8613800138000' })).toBe(true);
    expect(isAdminUser(user, { MYCC_ADMIN_USER_IDS: '7' })).toBe(false);
  });
});
