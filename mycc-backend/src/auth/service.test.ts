import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, findUserByCredential, findUserById, getSubscription } from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import { getCurrentUser, login, register, requireSafeJwtSecret } from './service.js';

vi.mock('../db/client.js', () => ({
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: vi.fn(),
  getSubscription: vi.fn(),
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
  it('does not expose linux user fields in register response users', async () => {
    vi.mocked(findUserByCredential).mockResolvedValue(null);
    vi.mocked(createUser).mockResolvedValue({
      id: 43,
      phone: undefined,
      email: 'new@example.test',
      password_hash: 'hash',
      assistant_name: '道友',
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

    const result = await register({
      email: 'new@example.test',
      password: 'test123456',
    });

    expect(result.user).not.toHaveProperty('linux_user');
    expect(result.user).not.toHaveProperty('linuxUser');
  });

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
    const existingUser = {
      id: 99,
      phone: undefined,
      email: 'new@example.test',
      password_hash: 'hash',
      assistant_name: '道友',
      linux_user: 'mycc_u99',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    vi.mocked(findUserByCredential).mockResolvedValue(existingUser);

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

describe('public auth user serialization', () => {
  it('does not expose linux user fields from login or current user responses', async () => {
    const storedUser = {
      id: 44,
      phone: undefined,
      email: 'login@example.test',
      password_hash: await bcrypt.hash('test123456', 10),
      assistant_name: '道友',
      linux_user: 'mycc_u44',
      status: 'active',
      is_initialized: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    vi.mocked(findUserByCredential).mockResolvedValue(storedUser);
    vi.mocked(findUserById).mockResolvedValue(storedUser);
    vi.mocked(getSubscription).mockResolvedValue({
      id: 3,
      user_id: 44,
      plan: 'free',
      tokens_limit: 300000,
      tokens_used: 10,
      reset_at: new Date(),
      expires_at: undefined,
      created_at: new Date(),
    });

    const loginResult = await login({
      credential: 'login@example.test',
      password: 'test123456',
    });
    const currentUser = await getCurrentUser(44);

    expect(loginResult.user).not.toHaveProperty('linux_user');
    expect(loginResult.user).not.toHaveProperty('linuxUser');
    expect(currentUser).not.toHaveProperty('linux_user');
    expect(currentUser).not.toHaveProperty('linuxUser');
  });
});

describe('login error privacy', () => {
  it('uses the same public error for missing accounts and wrong passwords', async () => {
    vi.mocked(findUserByCredential).mockResolvedValueOnce(null);

    await expect(login({
      credential: 'missing@example.test',
      password: 'test123456',
    })).rejects.toThrow('手机号/邮箱或密码错误');

    const storedUser = {
      id: 45,
      phone: undefined,
      email: 'login@example.test',
      password_hash: await bcrypt.hash('correct-password', 10),
      assistant_name: '道友',
      linux_user: 'mycc_u45',
      status: 'active',
      is_initialized: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    vi.mocked(findUserByCredential).mockResolvedValueOnce(storedUser);

    await expect(login({
      credential: 'login@example.test',
      password: 'wrong-password',
    })).rejects.toThrow('手机号/邮箱或密码错误');
  });
});
