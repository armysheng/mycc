import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsService } from './skills-service.js';

const context = {
  userId: 1,
  linuxUser: 'qa',
};

describe('SkillsService list cache', () => {
  beforeEach(() => {
    (SkillsService as any).listInFlight.clear();
    (SkillsService as any).listCache.clear();
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
      installSkill: vi.fn().mockResolvedValue('1.0.0'),
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
});
