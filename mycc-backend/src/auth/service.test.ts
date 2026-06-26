import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, findUserByCredential, getSubscription } from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import { register, requireSafeJwtSecret } from './service.js';

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
