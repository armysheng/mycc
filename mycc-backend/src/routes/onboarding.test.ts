import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onboardingRoutes,
  shouldRunOnboardingAsync,
  shouldPrepareOnboardingWorkspaceWithSsh,
} from './onboarding.js';
import { InMemoryIdeSessionStore } from '../ide/session-store.js';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  getSSHPool: vi.fn(),
  markUserInitialized: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  findUserById: mocks.findUserById,
  markUserInitialized: mocks.markUserInitialized,
}));

vi.mock('../ssh/pool.js', () => ({
  getSSHPool: mocks.getSSHPool,
}));

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';

function authHeader(overrides: Partial<{ userId: number; linuxUser: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: overrides.linuxUser ?? 'tester',
    role: 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('onboarding initialize', () => {
  beforeEach(() => {
    mocks.findUserById.mockReset();
    mocks.getSSHPool.mockReset();
    mocks.markUserInitialized.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses SSH workspace preparation unless E2B workspace mode is explicitly enabled', () => {
    expect(shouldPrepareOnboardingWorkspaceWithSsh({})).toBe(true);
    expect(shouldPrepareOnboardingWorkspaceWithSsh({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_IDE_PROVIDER: 'e2b',
      MYCC_WORKSPACE_PROVIDER: 'e2b',
    })).toBe(false);
  });

  it('runs onboarding synchronously by default and asynchronously only when enabled', () => {
    expect(shouldRunOnboardingAsync({})).toBe(false);
    expect(shouldRunOnboardingAsync({ MYCC_ONBOARDING_ASYNC: 'false' })).toBe(false);
    expect(shouldRunOnboardingAsync({ MYCC_ONBOARDING_ASYNC: 'true' })).toBe(true);
  });

  it('seeds Claude home and workspace over SSH, then returns ready without a bootstrap prompt', async () => {
    mocks.findUserById.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password_hash: 'hash',
      linux_user: 'mycc_u42',
      status: 'active',
      is_initialized: false,
      created_at: new Date('2026-05-30T00:00:00Z'),
      updated_at: new Date('2026-05-30T00:00:00Z'),
    });
    mocks.markUserInitialized.mockResolvedValue(true);

    const connection = { id: 'ssh-1' };
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });
    const release = vi.fn();
    mocks.getSSHPool.mockReturnValue({
      acquire: vi.fn().mockResolvedValue(connection),
      exec,
      release,
    });

    const app = Fastify({ logger: false });
    await app.register(onboardingRoutes, {
      env: {
        MYCC_WORKSPACE_PROVIDER: 'ssh',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/onboarding/initialize',
      headers: { authorization: authHeader() },
      payload: {
        assistantName: '道友 AI',
        ownerName: '测试用户',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'ready',
      },
    });
    expect(response.body).not.toContain('bootstrapPrompt');
    expect(response.body).not.toMatch(/linux_user|linuxUser|mycc_u42|用户不存在/i);
    const commands = exec.mock.calls.map((call) => call[1] as string);
    expect(commands.some((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))).toBe(true);
    expect(commands.some((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))).toBe(true);
    expect(commands.some((command) => command.includes('MYCC_WORKSPACE_LEGACY_IDENTITY_CLEANUP'))).toBe(true);
    expect(commands.join('\n')).not.toContain('/workspace/0-System/about-me');
    expect(mocks.markUserInitialized).toHaveBeenCalledWith({
      userId: 42,
      assistantName: '道友 AI',
    });
    expect(release).toHaveBeenCalledWith(connection);
    await app.close();
  });

  it('initializes E2B onboarding without touching the SSH pool', async () => {
    mocks.findUserById.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password_hash: 'hash',
      linux_user: 'mycc_u42',
      status: 'active',
      is_initialized: false,
      created_at: new Date('2026-05-30T00:00:00Z'),
      updated_at: new Date('2026-05-30T00:00:00Z'),
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH 连接池未初始化，请先调用 initSSHPool()');
    });
    mocks.markUserInitialized.mockResolvedValue(true);

    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_onboarding',
      codeServerPid: 123,
      host: '18080-sbx_onboarding.e2b.app',
      trafficAccessToken: 'traffic-secret',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'seeded',
      stderr: '',
    });
    const app = Fastify({ logger: false });
    await app.register(onboardingRoutes, {
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
        MYCC_E2B_TEMPLATE: 'mycc-code-server-dev',
      },
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/onboarding/initialize',
      headers: { authorization: authHeader() },
      payload: {
        assistantName: '小满',
        ownerName: '大辉',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        status: 'ready',
      },
    });
    expect(response.body).not.toContain('bootstrapPrompt');
    expect(response.body).not.toMatch(/linux_user|linuxUser|mycc_u42|用户不存在/i);
    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx_onboarding', userId: 42 }),
      expect.stringContaining('MYCC_CLAUDE_HOME_TEMPLATE_SEED'),
      {
        cwd: '/home/mycc',
        timeoutMs: 30000,
      },
    );
    const seedCommands = runCommandInSession.mock.calls.map((call) => call[1] as string);
    expect(seedCommands.some((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))).toBe(true);
    expect(seedCommands.some((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))).toBe(true);
    expect(seedCommands.some((command) => command.includes('MYCC_WORKSPACE_LEGACY_IDENTITY_CLEANUP'))).toBe(true);
    expect(seedCommands.some((command) => command.includes('MYCC_E2B_ONBOARDING_SEED'))).toBe(false);
    const claudeHomeSeedCommand = seedCommands.find((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))!;
    const workspaceSeedCommand = seedCommands.find((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))!;
    expect(claudeHomeSeedCommand).toContain('const claudeHomeDir="/home/mycc/.claude";');
    expect(claudeHomeSeedCommand).not.toContain('about-me/BOOTSTRAP.md');
    expect(claudeHomeSeedCommand).toContain('CLAUDE.md');
    expect(workspaceSeedCommand).toContain('CLAUDE.md');
    expect(workspaceSeedCommand).not.toContain('0-System/about-me');
    expect(mocks.getSSHPool).not.toHaveBeenCalled();
    expect(mocks.markUserInitialized).toHaveBeenCalledWith({
      userId: 42,
      assistantName: '小满',
    });
    await app.close();
  });

  it('can start asynchronous onboarding and report readiness by status polling', async () => {
    const user = {
      id: 42,
      email: 'new@example.test',
      password_hash: 'hash',
      linux_user: 'mycc_u42',
      status: 'active',
      is_initialized: false,
      created_at: new Date('2026-05-30T00:00:00Z'),
      updated_at: new Date('2026-05-30T00:00:00Z'),
    };
    mocks.findUserById.mockResolvedValue(user);
    mocks.markUserInitialized.mockResolvedValue(true);

    const connection = { id: 'ssh-async' };
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });
    mocks.getSSHPool.mockReturnValue({
      acquire: vi.fn().mockResolvedValue(connection),
      exec,
      release: vi.fn(),
    });

    const app = Fastify({ logger: false });
    await app.register(onboardingRoutes, {
      env: {
        MYCC_WORKSPACE_PROVIDER: 'ssh',
        MYCC_ONBOARDING_ASYNC: 'true',
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/onboarding/initialize',
      headers: { authorization: authHeader() },
      payload: {
        assistantName: '道友 AI',
        ownerName: '测试用户',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        status: 'running',
      },
    });
    expect(response.body).not.toContain('bootstrapPrompt');

    await vi.waitFor(() => {
      expect(mocks.markUserInitialized).toHaveBeenCalledWith({
        userId: 42,
        assistantName: '道友 AI',
      });
    });

    mocks.findUserById.mockResolvedValue({
      ...user,
      is_initialized: true,
    });

    const status = await app.inject({
      method: 'GET',
      url: '/api/onboarding/status',
      headers: { authorization: authHeader() },
    });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      success: true,
      data: {
        status: 'ready',
      },
    });
    await app.close();
  });

  it('keeps missing-user responses generic and free of internal details', async () => {
    mocks.findUserById.mockResolvedValue(null);

    const app = Fastify({ logger: false });
    await app.register(onboardingRoutes, {
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/onboarding/initialize',
      headers: { authorization: authHeader({ linuxUser: 'mycc_u18' }) },
      payload: {
        assistantName: '道友 AI',
        ownerName: '测试用户',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: '账号不可用，请重新登录',
    });
    expect(response.body).not.toMatch(/linux_user|linuxUser|mycc_u18|用户不存在/i);
    await app.close();
  });

  it('keeps E2B onboarding failures product-facing without leaking infrastructure details', async () => {
    mocks.findUserById.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password_hash: 'hash',
      linux_user: 'mycc_u42',
      status: 'active',
      is_initialized: false,
      created_at: new Date('2026-05-30T00:00:00Z'),
      updated_at: new Date('2026-05-30T00:00:00Z'),
    });
    mocks.getSSHPool.mockImplementation(() => {
      throw new Error('SSH 连接池未初始化，请先调用 initSSHPool()');
    });

    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_onboarding',
      codeServerPid: 123,
      host: '18080-sbx_onboarding.e2b.app',
      trafficAccessToken: 'traffic-secret',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'E2B sandbox seed failed: SSH 连接池未初始化，请先调用 initSSHPool(); token=traffic-secret',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = Fastify({ logger: false });
    await app.register(onboardingRoutes, {
      env: {
        MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
        MYCC_IDE_PROVIDER: 'e2b',
        MYCC_WORKSPACE_PROVIDER: 'e2b',
      },
      e2bProvider: {
        startCodeServer,
        runCommandInSession,
      },
      ideSessionStore: new InMemoryIdeSessionStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/onboarding/initialize',
      headers: { authorization: authHeader() },
      payload: {
        assistantName: '小满',
        ownerName: '大辉',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: '初始化暂时没完成，请稍后重试',
      code: 'initialization_unavailable',
    });
    expect(response.body).not.toMatch(/E2B|SSH|initSSHPool|sandbox|沙盒|token|traffic-secret|sbx_onboarding|e2b\.app|code-server/i);
    const logged = consoleError.mock.calls
      .flat()
      .map((value) => value instanceof Error ? value.message : String(value))
      .join('\n');
    expect(logged).not.toMatch(/E2B|SSH|initSSHPool|sandbox|沙盒|token|traffic-secret|sbx_onboarding|e2b\.app|code-server/i);
    expect(mocks.getSSHPool).not.toHaveBeenCalled();
    expect(mocks.markUserInitialized).not.toHaveBeenCalled();
    await app.close();
  });
});
