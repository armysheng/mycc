import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from './auth.js';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updateCurrentUserProfile: vi.fn(),
}));

vi.mock('../auth/service.js', () => ({
  getCurrentUser: mocks.getCurrentUser,
  login: mocks.login,
  register: mocks.register,
  updateCurrentUserProfile: mocks.updateCurrentUserProfile,
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(authRoutes);
  return app;
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes public registration gate config without invite codes', async () => {
    vi.stubEnv('MYCC_REGISTRATION_MODE', 'invite');
    vi.stubEnv('MYCC_REGISTRATION_INVITE_CODES', 'alpha,beta');
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/config',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        registration: {
          mode: 'invite',
          enabled: true,
          inviteRequired: true,
        },
      },
    });
    expect(response.body).not.toContain('alpha');
    expect(response.body).not.toContain('beta');
    await app.close();
  });

  it('does not expose internal registration errors', async () => {
    mocks.register.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "users_phone_key"'),
    );
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'new@example.test',
        password: 'test123456',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: '注册失败，请稍后重试',
    });
    expect(response.body).not.toContain('duplicate key');
    expect(response.body).not.toContain('users_phone_key');
    await app.close();
  });

  it('accepts phone-only registration when the email field is blank', async () => {
    mocks.register.mockResolvedValue({
      token: 'token',
      user: {
        id: 1,
        phone: '+8613800138000',
        email: null,
        assistant_name: 'cc',
        plan: 'free',
        is_initialized: false,
      },
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        phone: ' +8613800138000 ',
        email: '',
        password: 'test123456',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.register).toHaveBeenCalledWith({
      phone: '+8613800138000',
      email: undefined,
      password: 'test123456',
    });
    await app.close();
  });

  it('blocks registration when the public registration gate is closed', async () => {
    vi.stubEnv('MYCC_REGISTRATION_MODE', 'closed');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '203.0.113.20',
      payload: {
        email: 'closed@example.test',
        password: 'test123456',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'registration_closed',
      error: '暂未开放自助注册，请联系团队开通账号',
    });
    expect(mocks.register).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires a valid invite code when registration is invite-only', async () => {
    vi.stubEnv('MYCC_REGISTRATION_MODE', 'invite');
    vi.stubEnv('MYCC_REGISTRATION_INVITE_CODES', 'valid-code');
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '203.0.113.21',
      payload: {
        email: 'invite-missing@example.test',
        password: 'test123456',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'registration_invite_required',
      error: '注册当前仅面向内测邀请开放，请填写有效邀请码',
    });
    expect(mocks.register).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts invite-only registration with a configured invite code', async () => {
    vi.stubEnv('MYCC_REGISTRATION_MODE', 'invite');
    vi.stubEnv('MYCC_REGISTRATION_INVITE_CODES', 'valid-code');
    mocks.register.mockResolvedValue({
      token: 'token',
      user: {
        id: 2,
        phone: null,
        email: 'invited@example.test',
        assistant_name: 'cc',
        plan: 'free',
        is_initialized: false,
      },
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '203.0.113.22',
      payload: {
        email: 'invited@example.test',
        password: 'test123456',
        inviteCode: 'valid-code',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.register).toHaveBeenCalledWith({
      phone: undefined,
      email: 'invited@example.test',
      password: 'test123456',
    });
    expect(response.body).not.toContain('valid-code');
    await app.close();
  });

  it('does not expose linux user fields in public auth responses', async () => {
    mocks.login.mockResolvedValue({
      token: 'token',
      user: {
        id: 1,
        phone: '+8613800138000',
        email: null,
        assistant_name: 'cc',
        plan: 'free',
        is_initialized: false,
      },
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        credential: '+8613800138000',
        password: 'test123456',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('linux_user');
    expect(response.body).not.toContain('linuxUser');
    await app.close();
  });

  it('uses one recoverable login error to avoid account enumeration', async () => {
    mocks.login.mockRejectedValue(new Error('密码错误'));
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        credential: 'tester@example.test',
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      error: '手机号/邮箱或密码错误',
    });
    await app.close();
  });

  it('rate limits repeated login attempts from the same client and credential', async () => {
    mocks.login.mockRejectedValue(new Error('手机号/邮箱或密码错误'));
    const app = await buildApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '203.0.113.10',
        payload: {
          credential: 'tester@example.test',
          password: 'wrong-password',
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.10',
      payload: {
        credential: 'tester@example.test',
        password: 'wrong-password',
      },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      success: false,
      error: '尝试次数过多，请稍后再试',
    });
    await app.close();
  });

  it('rate limits repeated registration attempts from the same client and credential', async () => {
    mocks.register.mockRejectedValue(new Error('该手机号或邮箱已注册，请直接登录或换一个账号注册'));
    const app = await buildApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: '203.0.113.11',
        payload: {
          email: 'tester@example.test',
          password: 'test123456',
        },
      });
      expect(response.statusCode).toBe(400);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '203.0.113.11',
      payload: {
        email: 'tester@example.test',
        password: 'test123456',
      },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      success: false,
      error: '尝试次数过多，请稍后再试',
    });
    await app.close();
  });
});
