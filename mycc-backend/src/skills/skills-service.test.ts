import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsService } from './skills-service.js';

const skillEventMocks = vi.hoisted(() => ({
  getSkillStatsMap: vi.fn(),
  recordSkillEvent: vi.fn(),
}));

vi.mock('./skill-events.js', () => ({
  getSkillStatsMap: skillEventMocks.getSkillStatsMap,
  recordSkillEvent: skillEventMocks.recordSkillEvent,
}));

const context = {
  userId: 1,
  linuxUser: 'qa',
};

describe('SkillsService list cache', () => {
  beforeEach(() => {
    (SkillsService as any).listInFlight.clear();
    (SkillsService as any).listCache.clear();
    skillEventMocks.getSkillStatsMap.mockReset();
    skillEventMocks.recordSkillEvent.mockReset();
    skillEventMocks.getSkillStatsMap.mockResolvedValue(new Map());
    skillEventMocks.recordSkillEvent.mockResolvedValue(undefined);
  });

  it('listSkills 在 TTL 内命中缓存', async () => {
    const store = {
      listSkillInfos: vi.fn().mockResolvedValue({ skills: [], catalogAvailable: true }),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);

    await service.listSkills(context);
    await service.listSkills(context);

    expect(store.listSkillInfos).toHaveBeenCalledTimes(1);
  });

  it('写操作后失效缓存', async () => {
    const store = {
      listSkillInfos: vi.fn().mockResolvedValue({ skills: [], catalogAvailable: true }),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn().mockResolvedValue({
        version: '1.0.0',
        source: 'catalog',
        targetPath: '/home/qa/workspace/.claude/skills/deep-research',
      }),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);

    await service.listSkills(context);
    await service.installSkill(context, 'deep-research');
    await service.listSkills(context);

    expect(store.listSkillInfos).toHaveBeenCalledTimes(2);
  });

  it('SSH 运行时不可用时返回注册表降级列表而不是抛出 500', async () => {
    const store = {
      listSkillInfos: vi.fn().mockRejectedValue(new Error('SSH 连接池未初始化，请先调用 initSSHPool()')),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);

    const result = await service.listSkills(context);

    expect(result.catalogAvailable).toBe(false);
    expect(result.total).toBeGreaterThan(0);
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'tell-me',
      status: 'available',
      installed: false,
      source: 'registry',
    }));
  });

  it('listSkills 合并技能下载量和使用量统计', async () => {
    const store = {
      listSkillInfos: vi.fn().mockResolvedValue({
        catalogAvailable: true,
        skills: [
          {
            id: 'deep-research',
            name: '深度调研',
            description: '',
            trigger: '/deep-research',
            icon: '🔬',
            status: 'available',
            installed: false,
            version: '1.0.0',
            installedVersion: null,
            latestVersion: '1.0.0',
            source: 'catalog',
            legacy: false,
            enabled: false,
            upgradable: false,
          },
        ],
      }),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;
    skillEventMocks.getSkillStatsMap.mockResolvedValue(new Map([
      ['deep-research', { downloads: 7, installs: 3, updates: 2, uses: 11 }],
    ]));

    const service = new SkillsService(store);
    const result = await service.listSkills(context);

    expect(skillEventMocks.getSkillStatsMap).toHaveBeenCalledWith(['deep-research']);
    expect(result.skills[0]?.stats).toEqual({
      downloads: 7,
      installs: 3,
      updates: 2,
      uses: 11,
    });
  });

  it('installSkill 记录 download 和 install 事件', async () => {
    const store = {
      listSkillInfos: vi.fn(),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn().mockResolvedValue({
        version: '1.0.0',
        source: 'catalog',
        targetPath: '/home/qa/workspace/.claude/skills/deep-research',
      }),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);
    await service.installSkill(context, 'deep-research');

    expect(skillEventMocks.recordSkillEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      skillId: 'deep-research',
      eventType: 'download',
    }));
    expect(skillEventMocks.recordSkillEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      skillId: 'deep-research',
      eventType: 'install',
      version: '1.0.0',
      source: 'catalog',
      targetPath: '/home/qa/workspace/.claude/skills/deep-research',
    }));
  });

  it('upgradeSkill 记录 update 事件', async () => {
    const store = {
      listSkillInfos: vi.fn(),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn(),
      upgradeSkill: vi.fn().mockResolvedValue({
        version: '1.1.0',
        source: 'catalog',
        targetPath: '/home/qa/workspace/.claude/skills/deep-research',
      }),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);
    await service.upgradeSkill(context, 'deep-research');

    expect(skillEventMocks.recordSkillEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      skillId: 'deep-research',
      eventType: 'update',
      version: '1.1.0',
    }));
  });

  it('useSkill 记录 use 事件并返回成功', async () => {
    const store = {
      listSkillInfos: vi.fn(),
      ensureBuiltinSkills: vi.fn(),
      searchSkills: vi.fn(),
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      setSkillEnabled: vi.fn(),
      uninstallSkill: vi.fn(),
    } as any;

    const service = new SkillsService(store);
    const result = await service.useSkill(context, 'deep-research');

    expect(result).toEqual({ skillId: 'deep-research', success: true });
    expect(skillEventMocks.recordSkillEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      skillId: 'deep-research',
      eventType: 'use',
    }));
  });
});
