import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISkillsService } from '../skills/contracts.js';

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  createSkillsService: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  findUserById: mocks.findUserById,
}));

vi.mock('../skills/index.js', () => ({
  createSkillsService: mocks.createSkillsService,
  SkillsError: class MockSkillsError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  },
}));

const TEST_JWT_SECRET = 'your_jwt_secret_change_in_production';
let serviceMock: ISkillsService;

function authHeader(overrides: Partial<{ userId: number; linuxUser: string; role: string }> = {}): string {
  const token = jwt.sign({
    userId: overrides.userId ?? 42,
    linuxUser: overrides.linuxUser ?? 'qa',
    role: overrides.role ?? 'user',
    plan: 'free',
  }, TEST_JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

async function buildApp() {
  const { skillsRoutes } = await import('./skills.js');
  const app = Fastify({ logger: false });
  await app.register(skillsRoutes);
  return app;
}

function createServiceMock(): ISkillsService {
  return {
    getMarketSkills: vi.fn().mockReturnValue([
      {
        id: 'browser-use',
        name: '可见浏览器自动化',
        description: '操作网页',
        version: '1.0.0',
        trigger: '/browser-use',
        triggers: ['/browser-use', '访问网站'],
        icon: 'browser',
        category: 'devtools',
        builtin: false,
        preloadInImage: true,
        imageRequired: true,
        readiness: 'L1',
        deps: [],
        riskLevel: 'low',
        defaultEnabled: true,
        owner: 'mycc',
        mdPath: 'browser-use/SKILL.md',
        source_url: '',
        origin_type: 'internal-verified',
        validation_note: 'test',
        last_verified_at: '2026-06-01',
      },
    ]),
    ensureBuiltinSkills: vi.fn(),
    listSkills: vi.fn().mockResolvedValue({
      catalogAvailable: true,
      total: 2,
      skills: [
        {
          id: 'browser-use',
          name: '可见浏览器自动化',
          description: '操作网页',
          trigger: '/browser-use',
          triggers: ['/browser-use', '访问网站'],
          icon: 'browser',
          status: 'installed',
          installed: true,
          version: '1.0.0',
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          source: 'catalog',
          legacy: false,
          enabled: true,
          upgradable: true,
          preloadInImage: true,
          imageRequired: true,
          stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
        },
        {
          id: 'tell-me',
          name: '飞书通知',
          description: '发送通知',
          trigger: '/tell-me',
          triggers: ['/tell-me', '通知我'],
          icon: 'bell',
          status: 'available',
          installed: false,
          version: '1.0.0',
          installedVersion: null,
          latestVersion: '1.0.0',
          source: 'catalog',
          legacy: false,
          enabled: false,
          upgradable: false,
          preloadInImage: false,
          imageRequired: false,
          stats: { downloads: 1, installs: 0, updates: 0, uses: 0 },
        },
      ],
    }),
    getSkillDetail: vi.fn().mockResolvedValue({
      skill: {
        id: 'browser-use',
        name: '可见浏览器自动化',
        description: '操作网页',
        trigger: '/browser-use',
        triggers: ['/browser-use', '访问网站'],
        icon: 'browser',
        status: 'installed',
        installed: true,
        version: '1.0.0',
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        source: 'catalog',
        legacy: false,
        enabled: true,
        upgradable: true,
        preloadInImage: true,
        imageRequired: true,
        stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
      },
      installTargetPath: '/home/qa/.claude/skills/browser-use',
      definition: {
        builtin: false,
        readiness: 'L1',
        riskLevel: 'low',
        deps: ['playwright'],
        defaultEnabled: true,
        mdPath: 'browser-use/SKILL.md',
        sourceUrl: '',
        originType: 'internal-verified',
        validationNote: 'test',
        lastVerifiedAt: '2026-06-01',
      },
      contentPreview: {
        source: 'catalog',
        path: 'browser-use/SKILL.md',
        content: 'name: browser-use\n\ndescription\n操作网页',
        truncated: false,
      },
    }),
    searchSkills: vi.fn(),
    subscribeSkill: vi.fn().mockResolvedValue({
      skillId: 'browser-use',
      installed: true,
      version: '1.0.0',
      source: 'catalog',
      targetPath: '/home/qa/.claude/skills/browser-use',
    }),
    installSkill: vi.fn(),
    upgradeSkill: vi.fn().mockResolvedValue({
      skillId: 'browser-use',
      success: true,
      version: '1.1.0',
      source: 'catalog',
      targetPath: '/home/qa/.claude/skills/browser-use',
    }),
    enableSkill: vi.fn(),
    disableSkill: vi.fn(),
    uninstallSkill: vi.fn().mockResolvedValue({
      skillId: 'browser-use',
      success: true,
      uninstalled: true,
    }),
    useSkill: vi.fn().mockResolvedValue({
      skillId: 'browser-use',
      success: true,
    }),
  };
}

describe('skills routes', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.findUserById.mockResolvedValue({
      id: 42,
      email: 'qa@example.test',
      password_hash: 'hash',
      linux_user: 'qa',
      status: 'active',
      is_initialized: true,
      created_at: new Date('2026-06-01T00:00:00.000Z'),
      updated_at: new Date('2026-06-01T00:00:00.000Z'),
    });
    serviceMock = createServiceMock();
    mocks.createSkillsService.mockReturnValue(serviceMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('subscribes a skill through the explicit route and returns the Claude skills path', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/browser-use/subscribe',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        skillId: 'browser-use',
        installed: true,
        version: '1.0.0',
        source: 'catalog',
        targetPath: '/home/qa/.claude/skills/browser-use',
      },
    });
    await app.close();
  });

  it('returns skill detail with install target and content preview', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/browser-use/detail',
      headers: { authorization: authHeader() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        skill: {
          id: 'browser-use',
          name: '可见浏览器自动化',
        },
        installTargetPath: '/home/qa/.claude/skills/browser-use',
        definition: {
          mdPath: 'browser-use/SKILL.md',
          lastVerifiedAt: '2026-06-01',
        },
        contentPreview: {
          source: 'catalog',
          path: 'browser-use/SKILL.md',
        },
      },
    });
    expect(serviceMock.getSkillDetail).toHaveBeenCalledWith({ userId: 42, linuxUser: 'qa' }, 'browser-use');
    await app.close();
  });

  it('routes upgrade, uninstall, and use actions through the user runtime context', async () => {
    const app = await buildApp();

    const upgrade = await app.inject({
      method: 'POST',
      url: '/api/skills/browser-use/upgrade',
      headers: { authorization: authHeader() },
    });
    const use = await app.inject({
      method: 'POST',
      url: '/api/skills/browser-use/use',
      headers: { authorization: authHeader() },
    });
    const uninstall = await app.inject({
      method: 'POST',
      url: '/api/skills/browser-use/uninstall',
      headers: { authorization: authHeader() },
    });

    expect(upgrade.statusCode).toBe(200);
    expect(upgrade.json()).toEqual({
      success: true,
      data: {
        skillId: 'browser-use',
        success: true,
        version: '1.1.0',
        source: 'catalog',
        targetPath: '/home/qa/.claude/skills/browser-use',
      },
    });
    expect(use.statusCode).toBe(200);
    expect(use.json()).toEqual({
      success: true,
      data: {
        skillId: 'browser-use',
        success: true,
      },
    });
    expect(uninstall.statusCode).toBe(200);
    expect(uninstall.json()).toEqual({
      success: true,
      data: {
        skillId: 'browser-use',
        success: true,
        uninstalled: true,
      },
    });
    const context = { userId: 42, linuxUser: 'qa' };
    expect(serviceMock.upgradeSkill).toHaveBeenCalledWith(context, 'browser-use');
    expect(serviceMock.useSkill).toHaveBeenCalledWith(context, 'browser-use');
    expect(serviceMock.uninstallSkill).toHaveBeenCalledWith(context, 'browser-use');
    await app.close();
  });

  it('returns runtime-not-ready errors as a 503 contract for write actions', async () => {
    const { SkillsError } = await import('../skills/index.js');
    const app = await buildApp();

    const runtimeError = () =>
      new SkillsError(503, '技能运行环境尚未就绪，请稍后重试');
    const cases = [
      {
        assignMock: () => {
          serviceMock.installSkill = vi.fn().mockRejectedValue(runtimeError());
        },
        getMock: () => serviceMock.installSkill,
        url: '/api/skills/browser-use/install',
      },
      {
        assignMock: () => {
          serviceMock.subscribeSkill = vi.fn().mockRejectedValue(runtimeError());
        },
        getMock: () => serviceMock.subscribeSkill,
        url: '/api/skills/browser-use/subscribe',
      },
      {
        assignMock: () => {
          serviceMock.upgradeSkill = vi.fn().mockRejectedValue(runtimeError());
        },
        getMock: () => serviceMock.upgradeSkill,
        url: '/api/skills/browser-use/upgrade',
      },
      {
        assignMock: () => {
          serviceMock.uninstallSkill = vi.fn().mockRejectedValue(runtimeError());
        },
        getMock: () => serviceMock.uninstallSkill,
        url: '/api/skills/browser-use/uninstall',
      },
    ];

    for (const item of cases) {
      item.assignMock();

      const response = await app.inject({
        method: 'POST',
        url: item.url,
        headers: { authorization: authHeader() },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        success: false,
        error: '技能运行环境尚未就绪，请稍后重试',
      });
      expect(item.getMock()).toHaveBeenCalledWith(
        { userId: 42, linuxUser: 'qa' },
        'browser-use'
      );
    }

    await app.close();
  });

  it('returns admin debug counts and image metadata for mainline integration', async () => {
    vi.stubEnv('MYCC_ADMIN_USER_IDS', '42');
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/debug',
      headers: { authorization: authHeader({ role: 'admin' }) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        catalogAvailable: true,
        marketCount: 1,
        installedCount: 1,
        availableCount: 1,
        upgradableCount: 1,
        imagePreloadCount: 1,
        imageRequiredCount: 1,
        skills: [
          {
            id: 'browser-use',
            triggers: ['/browser-use', '访问网站'],
            preloadInImage: true,
            imageRequired: true,
            stats: { downloads: 4, installs: 3, updates: 1, uses: 9 },
          },
          {
            id: 'tell-me',
            preloadInImage: false,
            imageRequired: false,
          },
        ],
      },
    });
    await app.close();
  });

  it('keeps the debug snapshot admin-only', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/debug',
      headers: { authorization: authHeader({ role: 'user' }) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      success: false,
      error: '需要管理员权限',
    });
    await app.close();
  });
});
