import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBootstrapPrompt,
  onboardingRoutes,
  shouldPrepareOnboardingWorkspaceWithSsh,
} from './onboarding.js';
import { InMemoryIdeSessionStore } from '../ide/session-store.js';
import { __resetOnboardingBootstrapTicketStoreForTests } from '../onboarding/bootstrap-ticket-store.js';

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

describe('onboarding bootstrap prompt', () => {
  beforeEach(() => {
    __resetOnboardingBootstrapTicketStoreForTests();
    mocks.findUserById.mockReset();
    mocks.getSSHPool.mockReset();
    mocks.markUserInitialized.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('embeds assistant and owner names into first-turn bootstrap message', () => {
    const prompt = buildBootstrapPrompt({
      assistantName: '  cc  ',
      ownerName: '  婷妈  ',
      linuxUser: 'mycc_u2',
      bootstrapToken: 'ticket-123',
    });

    expect(prompt).toContain('助手名称：cc');
    expect(prompt).toContain('用户称呼：婷妈');
    expect(prompt).toContain('~/.claude/about-me/BOOTSTRAP.md');
    expect(prompt).toContain('/home/mycc_u2/workspace/CLAUDE.md');
    expect(prompt).toContain('/home/mycc_u2/.claude/CLAUDE.md');
    expect(prompt).toContain('/home/mycc_u2/.claude/projects/-home-mycc-u2-workspace/memory/MEMORY.md');
    expect(prompt).toContain('以 `~/.claude/about-me/` 作为唯一身份真相源');
    expect(prompt).toContain('确保存在 ~/.claude/memory/ 目录');
    expect(prompt).toContain('初始化票据：ticket-123');
    expect(prompt).toContain('已完成初始化');
    expect(prompt).toContain('<!-- MYCC_BOOTSTRAP_REQUIRED -->');
    expect(prompt).toContain('初始化成功后删除这一行');
    expect(prompt).not.toContain('更新 0-System/about-me');
  });

  it('uses SSH workspace preparation unless E2B workspace mode is explicitly enabled', () => {
    expect(shouldPrepareOnboardingWorkspaceWithSsh({})).toBe(true);
    expect(shouldPrepareOnboardingWorkspaceWithSsh({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_IDE_PROVIDER: 'e2b',
      MYCC_WORKSPACE_PROVIDER: 'e2b',
    })).toBe(false);
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
        bootstrapPrompt: expect.stringContaining('助手名称：小满'),
      },
    });
    expect(response.body).toContain('用户称呼：大辉');
    expect(response.body).toContain('初始化票据：');
    expect(startCodeServer).toHaveBeenCalledOnce();
    expect(runCommandInSession).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx_onboarding', userId: 42 }),
      expect.stringContaining('MYCC_CLAUDE_HOME_TEMPLATE_SEED'),
      {
        cwd: '/home/mycc/.claude',
        timeoutMs: 30000,
      },
    );
    const seedCommands = runCommandInSession.mock.calls.map((call) => call[1] as string);
    expect(seedCommands.some((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))).toBe(true);
    expect(seedCommands.some((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))).toBe(true);
    expect(seedCommands.some((command) => command.includes('MYCC_E2B_ONBOARDING_SEED'))).toBe(false);
    const claudeHomeSeedCommand = seedCommands.find((command) => command.includes('MYCC_CLAUDE_HOME_TEMPLATE_SEED'))!;
    const workspaceSeedCommand = seedCommands.find((command) => command.includes('MYCC_WORKSPACE_TEMPLATE_SEED'))!;
    expect(claudeHomeSeedCommand).toContain('about-me/BOOTSTRAP.md');
    expect(claudeHomeSeedCommand).toContain('CLAUDE.md');
    expect(workspaceSeedCommand).toContain('CLAUDE.md');
    expect(workspaceSeedCommand).not.toContain('0-System/about-me');
    expect(mocks.getSSHPool).not.toHaveBeenCalled();
    expect(mocks.markUserInitialized).not.toHaveBeenCalled();
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
