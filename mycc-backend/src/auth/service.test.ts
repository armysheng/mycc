import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
  createUser,
  findUserByCredential,
  findUserById,
  findUserByOAuthAccount,
  getSubscription,
  linkOAuthAccount,
  createOAuthUserWithAccount,
  updateUserProfile,
} from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import {
  getCurrentUser,
  buildOAuthAuthorizationUrl,
  buildOAuthFrontendRedirect,
  getOAuthPublicConfig,
  loginWithOAuthProfile,
  login,
  register,
  requireSafeJwtSecret,
  updateCurrentUserProfile,
} from './service.js';

vi.mock('../db/client.js', () => ({
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: vi.fn(),
  findUserByOAuthAccount: vi.fn(),
  getSubscription: vi.fn(),
  linkOAuthAccount: vi.fn(),
  createOAuthUserWithAccount: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('../vps/user-manager.js', () => ({
  vpsUserManager: {
    createUser: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vpsUserManager.createUser).mockResolvedValue(undefined);
  delete process.env.MYCC_AGENT_RUNTIME;
  delete process.env.MYCC_IDE_PROVIDER;
  delete process.env.MYCC_WORKSPACE_PROVIDER;
  delete process.env.MYCC_SKIP_SSH_STARTUP_CHECK;
  delete process.env.MYCC_REGISTRATION_MODE;
  delete process.env.MYCC_REGISTRATION_ENABLED;
  delete process.env.MYCC_AUTH_PUBLIC_BASE_URL;
  delete process.env.MYCC_OAUTH_GOOGLE_CLIENT_ID;
  delete process.env.MYCC_OAUTH_GOOGLE_CLIENT_SECRET;
  delete process.env.MYCC_OAUTH_GITHUB_CLIENT_ID;
  delete process.env.MYCC_OAUTH_GITHUB_CLIENT_SECRET;
});

describe('OAuth provider config', () => {
  it('keeps OAuth providers disabled until both client id and secret are configured', () => {
    process.env.MYCC_OAUTH_GOOGLE_CLIENT_ID = 'google-client';

    expect(getOAuthPublicConfig()).toEqual({
      providers: {
        google: {
          enabled: false,
          authUrl: '/api/auth/oauth/google/start',
        },
        github: {
          enabled: false,
          authUrl: '/api/auth/oauth/github/start',
        },
      },
    });
  });

  it('treats placeholder OAuth credentials as disabled', () => {
    process.env.MYCC_OAUTH_GOOGLE_CLIENT_ID = '__PLACEHOLDER_GOOGLE_CLIENT_ID__';
    process.env.MYCC_OAUTH_GOOGLE_CLIENT_SECRET = '__PLACEHOLDER_GOOGLE_CLIENT_SECRET__';
    process.env.MYCC_OAUTH_GITHUB_CLIENT_ID = '<github-client-id>';
    process.env.MYCC_OAUTH_GITHUB_CLIENT_SECRET = 'replace-me';

    expect(getOAuthPublicConfig()).toEqual({
      providers: {
        google: {
          enabled: false,
          authUrl: '/api/auth/oauth/google/start',
        },
        github: {
          enabled: false,
          authUrl: '/api/auth/oauth/github/start',
        },
      },
    });
  });

  it('builds provider authorization URLs with signed state and without client secrets', () => {
    process.env.MYCC_AUTH_PUBLIC_BASE_URL = 'https://daoyou.iaigc.fun/';
    process.env.MYCC_OAUTH_GOOGLE_CLIENT_ID = 'google-client';
    process.env.MYCC_OAUTH_GOOGLE_CLIENT_SECRET = 'google-secret';

    const authorizationUrl = buildOAuthAuthorizationUrl('google', {
      returnTo: '/projects/demo',
    });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state');

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://daoyou.iaigc.fun/api/auth/oauth/google/callback');
    expect(authorizationUrl).not.toContain('google-secret');
    expect(state).toBeTruthy();
    expect(jwt.verify(state!, 'your_jwt_secret_change_in_production')).toMatchObject({
      type: 'oauth_state',
      provider: 'google',
      returnTo: '/projects/demo',
    });
  });

  it('builds frontend redirects with one-time OAuth codes instead of tokens', () => {
    const redirect = buildOAuthFrontendRedirect({
      code: 'login-code',
      returnTo: '/projects/demo',
    }, {
      MYCC_AUTH_FRONTEND_BASE_URL: 'https://app.example.test/',
    });

    expect(redirect).toBe('https://app.example.test/login#oauth_code=login-code&return_to=%2Fprojects%2Fdemo');
    expect(redirect).not.toContain('oauth_token');
  });
});

describe('JWT secret safety', () => {
  it('rejects the development placeholder in production', () => {
    expect(() =>
      requireSafeJwtSecret({
        NODE_ENV: 'production',
        JWT_SECRET: 'your_jwt_secret_change_in_production',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('requires a configured secret in production', () => {
    expect(() =>
      requireSafeJwtSecret({
        NODE_ENV: 'production',
        JWT_SECRET: '',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('allows the placeholder outside production for local tests', () => {
    expect(
      requireSafeJwtSecret({
        NODE_ENV: 'test',
        JWT_SECRET: 'your_jwt_secret_change_in_production',
      }),
    ).toBe('your_jwt_secret_change_in_production');
  });
});

describe('register runtime side effects', () => {
  it('maps duplicate credential storage errors to a product-facing message', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createUser).mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), {
        code: '23505',
        constraint: 'users_phone_key',
      }),
    );

    await expect(register({
      email: 'new@example.test',
      password: 'test123456',
    })).rejects.toThrow('该手机号或邮箱已注册，请直接登录或换一个账号注册');
  });

  it('treats blank optional credentials as not provided before creating the user', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: 43,
      phone: undefined,
      email: 'new@example.test',
      password_hash: 'hash',
      assistant_name: 'cc',
      linux_user: 'mycc_u43',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    vi.mocked(getSubscription).mockResolvedValue({
      id: 2,
      user_id: 43,
      plan: 'free',
      tokens_limit: 300000,
      tokens_used: 0,
      reset_at: new Date(),
      expires_at: undefined,
      created_at: new Date(),
    });

    await register({
      phone: '   ',
      email: ' New@Example.TEST ',
      password: 'test123456',
    });

    expect(findUserByCredential).toHaveBeenCalledWith('new@example.test');
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      phone: undefined,
      email: 'new@example.test',
    }));
  });

  it('normalizes email casing before checking duplicate accounts', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue({
      id: 99,
      phone: undefined,
      email: 'new@example.test',
      password_hash: 'hash',
      assistant_name: 'cc',
      linux_user: 'mycc_u99',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(register({
      email: ' New@Example.TEST ',
      password: 'test123456',
    })).rejects.toThrow('该手机号或邮箱已注册，请直接登录或换一个账号注册');

    expect(findUserByCredential).toHaveBeenCalledWith('new@example.test');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('does not create legacy VPS users on the E2B product path', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: 42,
      phone: '+8613800138000',
      email: undefined,
      password_hash: 'hash',
      assistant_name: 'cc',
      linux_user: 'mycc_u42',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    vi.mocked(getSubscription).mockResolvedValue({
      id: 1,
      user_id: 42,
      plan: 'free',
      tokens_limit: 300000,
      tokens_used: 0,
      reset_at: new Date(),
      expires_at: undefined,
      created_at: new Date(),
    });
    process.env.MYCC_AGENT_RUNTIME = 'e2b-claude-agent-sdk';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_WORKSPACE_PROVIDER = 'e2b';

    await register({
      phone: '+8613800138000',
      password: 'test123456',
    });

    expect(vpsUserManager.createUser).not.toHaveBeenCalled();
  });
});

describe('public auth responses', () => {
  const userRecord = {
    id: 42,
    phone: '+8613800138000',
    email: 'tester@example.com',
    password_hash: '$2b$10$012345678901234567890uMT6wdtPVwV0pBYg98qgkW4tHsCPjBZK',
    assistant_name: 'cc',
    linux_user: 'mycc_u42',
    status: 'active',
    is_initialized: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const subscription = {
    id: 1,
    user_id: 42,
    plan: 'free' as const,
    tokens_limit: 300000,
    tokens_used: 1000,
    reset_at: new Date('2026-07-01T00:00:00.000Z'),
    expires_at: undefined,
    created_at: new Date(),
  };

  beforeEach(() => {
    vi.mocked(getSubscription).mockResolvedValue(subscription);
  });

  it('does not expose linux_user after registration', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue(userRecord);

    const result = await register({
      email: 'tester@example.com',
      password: 'test123456',
    });

    expect(result.user).not.toHaveProperty('linux_user');
    expect(result.user).toMatchObject({
      id: 42,
      email: 'tester@example.com',
      plan: 'free',
      is_initialized: true,
    });
  });

  it('does not expose linux_user after login', async () => {
    const password_hash = await bcrypt.hash('test123456', 10);
    vi.mocked(findUserByCredential).mockResolvedValue({
      ...userRecord,
      password_hash,
    });

    const result = await login({
      credential: 'tester@example.com',
      password: 'test123456',
    });

    expect(result.user).not.toHaveProperty('linux_user');
    expect(result.user.email).toBe('tester@example.com');
  });

  it('does not expose linux_user from current-user and profile responses', async () => {
    vi.mocked(findUserById).mockResolvedValue(userRecord);
    vi.mocked(updateUserProfile).mockResolvedValue({
      ...userRecord,
      assistant_name: '小麦',
    });

    const currentUser = await getCurrentUser(42);
    const updatedUser = await updateCurrentUserProfile(42, {
      assistantName: '小麦',
    });

    expect(currentUser).not.toHaveProperty('linux_user');
    expect(updatedUser).not.toHaveProperty('linux_user');
    expect(currentUser.subscription).toMatchObject({
      tokens_remaining: 299000,
    });
    expect(updatedUser.assistant_name).toBe('小麦');
  });
});

describe('login error privacy', () => {
  it('uses the same public error for missing accounts and wrong passwords', async () => {
    vi.mocked(findUserByCredential).mockResolvedValueOnce(null);

    await expect(login({
      credential: 'missing@example.test',
      password: 'test123456',
    })).rejects.toThrow('手机号/邮箱或密码错误');

    vi.mocked(findUserByCredential).mockResolvedValueOnce({
      id: 45,
      phone: undefined,
      email: 'login@example.test',
      password_hash: await bcrypt.hash('correct-password', 10),
      assistant_name: 'cc',
      linux_user: 'mycc_u45',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(login({
      credential: 'login@example.test',
      password: 'wrong-password',
    })).rejects.toThrow('手机号/邮箱或密码错误');
  });
});

describe('OAuth login', () => {
  const subscription = {
    id: 1,
    user_id: 42,
    plan: 'free' as const,
    tokens_limit: 300000,
    tokens_used: 1000,
    reset_at: new Date('2026-07-01T00:00:00.000Z'),
    expires_at: undefined,
    created_at: new Date(),
  };

  const userRecord = {
    id: 42,
    phone: undefined,
    email: 'linked@example.test',
    password_hash: '$2b$10$012345678901234567890uMT6wdtPVwV0pBYg98qgkW4tHsCPjBZK',
    assistant_name: 'cc',
    linux_user: 'mycc_u42',
    status: 'active',
    is_initialized: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    vi.mocked(getSubscription).mockResolvedValue(subscription);
  });

  it('logs in through an existing linked provider account', async () => {
    vi.mocked(findUserByOAuthAccount).mockResolvedValue(userRecord);

    const result = await loginWithOAuthProfile({
      provider: 'github',
      providerUserId: '12345',
      email: undefined,
      emailVerified: false,
    });

    expect(findUserByOAuthAccount).toHaveBeenCalledWith('github', '12345');
    expect(findUserByCredential).not.toHaveBeenCalled();
    expect(linkOAuthAccount).not.toHaveBeenCalled();
    expect(result.user).toMatchObject({
      id: 42,
      email: 'linked@example.test',
      plan: 'free',
    });
    expect(result.user).not.toHaveProperty('linux_user');
  });

  it('links a verified provider email to an existing password account', async () => {
    vi.mocked(findUserByOAuthAccount).mockResolvedValue(null);
    vi.mocked(findUserByCredential).mockResolvedValue(userRecord);

    const result = await loginWithOAuthProfile({
      provider: 'google',
      providerUserId: 'google-sub-1',
      email: ' Linked@Example.TEST ',
      emailVerified: true,
    });

    expect(findUserByCredential).toHaveBeenCalledWith('linked@example.test');
    expect(linkOAuthAccount).toHaveBeenCalledWith({
      userId: 42,
      provider: 'google',
      providerUserId: 'google-sub-1',
      email: 'linked@example.test',
      emailVerified: true,
    });
    expect(createOAuthUserWithAccount).not.toHaveBeenCalled();
    expect(result.user.id).toBe(42);
  });

  it('uses the provider-linked account after an OAuth link race', async () => {
    const raceWinner = {
      ...userRecord,
      id: 84,
      email: 'winner@example.test',
      linux_user: 'mycc_u84',
    };
    vi.mocked(findUserByOAuthAccount)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raceWinner);
    vi.mocked(findUserByCredential).mockResolvedValue(userRecord);

    const result = await loginWithOAuthProfile({
      provider: 'google',
      providerUserId: 'google-sub-race',
      email: 'linked@example.test',
      emailVerified: true,
    });

    expect(linkOAuthAccount).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      provider: 'google',
      providerUserId: 'google-sub-race',
    }));
    expect(findUserByOAuthAccount).toHaveBeenLastCalledWith('google', 'google-sub-race');
    expect(result.user.id).toBe(84);
  });

  it('rejects first-time OAuth login when the provider email is unverified', async () => {
    vi.mocked(findUserByOAuthAccount).mockResolvedValue(null);

    await expect(loginWithOAuthProfile({
      provider: 'github',
      providerUserId: 'github-1',
      email: 'new@example.test',
      emailVerified: false,
    })).rejects.toThrow('第三方账号邮箱尚未验证，请先完成邮箱验证后再登录');

    expect(findUserByCredential).not.toHaveBeenCalled();
    expect(linkOAuthAccount).not.toHaveBeenCalled();
    expect(createOAuthUserWithAccount).not.toHaveBeenCalled();
  });

  it('creates a new account for a verified OAuth email without exposing internals', async () => {
    vi.mocked(findUserByOAuthAccount).mockResolvedValue(null);
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createOAuthUserWithAccount).mockResolvedValue({
      ...userRecord,
      id: 77,
      email: 'new@example.test',
      linux_user: 'mycc_u77',
    });

    const result = await loginWithOAuthProfile({
      provider: 'google',
      providerUserId: 'google-sub-77',
      email: 'NEW@Example.TEST',
      emailVerified: true,
    });

    expect(createOAuthUserWithAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@example.test',
      provider: 'google',
      providerUserId: 'google-sub-77',
      emailVerified: true,
      password_hash: expect.stringMatching(/^\$2[aby]\$/),
    }));
    expect(result.user).toMatchObject({
      id: 77,
      email: 'new@example.test',
      plan: 'free',
    });
    expect(result.user).not.toHaveProperty('linux_user');
  });

  it('blocks new OAuth account creation when public registration is closed', async () => {
    process.env.MYCC_REGISTRATION_MODE = 'closed';
    vi.mocked(findUserByOAuthAccount).mockResolvedValue(null);
    vi.mocked(findUserByCredential).mockResolvedValue(null);

    await expect(loginWithOAuthProfile({
      provider: 'google',
      providerUserId: 'google-sub-88',
      email: 'new@example.test',
      emailVerified: true,
    })).rejects.toThrow('暂未开放自助注册，请联系团队开通账号');

    expect(createOAuthUserWithAccount).not.toHaveBeenCalled();
  });
});
