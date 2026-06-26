import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsError } from './errors.js';
import { RemoteSkillStore } from './remote-skill-store.js';

type ExecResult = { stdout: string; stderr: string; exitCode: number | null };

const sshMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('../ssh/pool.js', () => ({
  getSSHPool: () => sshMocks,
}));

function ok(stdout = ''): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function skillMd(version: string): string {
  return `---\nversion: ${version}\n---\n`;
}

function skillMdWithoutVersion(): string {
  return `---\nname: deep-research\n---\n`;
}

function hasDirCheck(command: string, path: string): boolean {
  return command.includes(path) && command.includes('echo ok || true');
}

function hasCat(command: string, path: string): boolean {
  return command.includes('cat') && command.includes(path);
}

describe('remote-skill-store regression', () => {
  beforeEach(() => {
    sshMocks.acquire.mockResolvedValue({ id: 'conn-1' });
    sshMocks.release.mockReset();
    sshMocks.exec.mockReset();
    delete process.env.SKILLS_CATALOG_DIR;
    (RemoteSkillStore as any).catalogCache.clear();
  });

  it('installSkill: 只从本地 catalog 安装并返回 Claude skills 目标路径', async () => {
    const store = new RemoteSkillStore();
    const installSkill = vi.fn().mockRejectedValue(new Error('should not call clawhub'));
    (store as any).clawhubAdapter = {
      installSkill,
      upgradeSkill: vi.fn(),
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills: vi.fn().mockResolvedValue([]),
    };

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (hasDirCheck(command, '/home/qa/.claude/skills/tell-me')) {
        return ok('');
      }
      if (command.includes("[ -d '/opt/mycc/.claude/skills' ] && echo '/opt/mycc/.claude/skills'")) {
        return ok('/opt/mycc/.claude/skills\n');
      }
      if (hasDirCheck(command, '/opt/mycc/.claude/skills/tell-me')) {
        return ok('');
      }
      if (hasDirCheck(command, '/opt/mycc/mycc/.claude/skills/tell-me')) {
        return ok('ok\n');
      }
      if (
        command.includes('cp -a') &&
        command.includes('/opt/mycc/mycc/.claude/skills/tell-me') &&
        command.includes('/home/qa/.claude/skills/tell-me')
      ) {
        return ok('');
      }
      if (hasCat(command, '/home/qa/.claude/skills/tell-me/SKILL.md')) {
        return ok(skillMd('1.2.3'));
      }
      if (command.includes("MANIFEST='/home/qa/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const result = await store.installSkill('qa', 'tell-me');

    expect(result).toEqual({
      version: '1.2.3',
      source: 'catalog',
      targetPath: '/home/qa/.claude/skills/tell-me',
    });
    expect(installSkill).not.toHaveBeenCalled();
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('cp -a') && command.includes('/opt/mycc/mycc/.claude/skills/tell-me')
      )
    ).toBe(true);
  });

  it('installSkill: 市场 id 与 Claude skill name 不同时使用 SKILL.md name 作为安装目录', async () => {
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();
    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo ok || true")) return ok('ok\n');
      if (hasDirCheck(command, '/catalog/browser')) return ok('ok\n');
      if (hasCat(command, '/catalog/browser/SKILL.md')) {
        return ok('---\nname: webapp-testing\nversion: 2.0.0\n---\n');
      }
      if (hasDirCheck(command, '/home/qa/.claude/skills/webapp-testing')) return ok('');
      if (hasDirCheck(command, '/home/qa/.claude/skills/browser')) return ok('');
      if (
        command.includes('cp -a') &&
        command.includes('/catalog/browser') &&
        command.includes('/home/qa/.claude/skills/webapp-testing')
      ) {
        return ok('');
      }
      if (hasCat(command, '/home/qa/.claude/skills/webapp-testing/SKILL.md')) {
        return ok('---\nname: webapp-testing\nversion: 2.0.0\n---\n');
      }
      if (command.includes("MANIFEST='/home/qa/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const result = await store.installSkill(linuxUser, 'browser');

    expect(result).toEqual({
      version: '2.0.0',
      source: 'catalog',
      targetPath: '/home/qa/.claude/skills/webapp-testing',
    });
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('cp -a') &&
        command.includes('/catalog/browser') &&
        command.includes('/home/qa/.claude/skills/webapp-testing')
      )
    ).toBe(true);
  });

  it('upgradeSkill: 从本地 catalog 更新，保留禁用状态并返回目标路径', async () => {
    const store = new RemoteSkillStore();
    const upgradeSkill = vi.fn().mockRejectedValue(new Error('should not call clawhub'));
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill,
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills: vi.fn().mockResolvedValue([]),
    };

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (hasDirCheck(command, '/home/qa/.claude/skills/scheduler')) {
        return ok('ok\n');
      }
      if (hasCat(command, '/home/qa/.claude/skills/.mycc-manifest.json')) {
        return ok('{"skills":{"scheduler":{"source":"clawhub","disabled":true}}}');
      }
      if (command.includes("[ -d '/opt/mycc/.claude/skills' ] && echo '/opt/mycc/.claude/skills'")) {
        return ok('/opt/mycc/.claude/skills\n');
      }
      if (hasDirCheck(command, '/opt/mycc/.claude/skills/scheduler')) {
        return ok('');
      }
      if (hasDirCheck(command, '/opt/mycc/mycc/.claude/skills/scheduler')) {
        return ok('ok\n');
      }
      if (
        command.includes('rm -rf') &&
        command.includes('/home/qa/.claude/skills/scheduler') &&
        command.includes('/opt/mycc/mycc/.claude/skills/scheduler')
      ) {
        return ok('');
      }
      if (hasCat(command, '/home/qa/.claude/skills/scheduler/SKILL.md')) {
        return ok(skillMd('2.0.0'));
      }
      if (command.includes("MANIFEST='/home/qa/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const result = await store.upgradeSkill('qa', 'scheduler');

    expect(result).toEqual({
      version: '2.0.0',
      source: 'catalog',
      targetPath: '/home/qa/.claude/skills/scheduler',
    });
    expect(upgradeSkill).not.toHaveBeenCalled();
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('rm -rf') && command.includes('/opt/mycc/mycc/.claude/skills/scheduler')
      )
    ).toBe(true);
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('DISABLED=') && command.includes('true')
      )
    ).toBe(true);
  });

  it('resolveCatalogDir 缓存: root 可见但 user 不可见时不应误判失效', async () => {
    const store = new RemoteSkillStore();
    const linuxUser = 'qa';
    const cachedPath = '/opt/shared/catalog';

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: cachedPath,
      expiresAt: Date.now() + 60_000,
    });

    const execAsRoot = vi.fn(async (command: string): Promise<ExecResult> => {
      if (command.includes(`[ -d '${cachedPath}' ] && echo ok || true`)) {
        return ok('ok\n');
      }
      return ok('');
    });
    const execAsUser = vi.fn(async (): Promise<ExecResult> => ok(''));

    const resolved = await (store as any).resolveCatalogDir(execAsRoot, execAsUser, linuxUser);

    expect(resolved).toBe(cachedPath);
    expect(execAsUser).not.toHaveBeenCalled();
    expect((RemoteSkillStore as any).catalogCache.get(linuxUser)?.path).toBe(cachedPath);
  });
});

describe('RemoteSkillStore.uninstallSkill', () => {
  beforeEach(() => {
    sshMocks.exec.mockReset();
    sshMocks.acquire.mockReset();
    sshMocks.release.mockReset();

    sshMocks.acquire.mockResolvedValue({ id: 'conn-1' });
    sshMocks.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('删除技能目录并清理 manifest/lock', async () => {
    const store = new RemoteSkillStore();

    await store.uninstallSkill('alice', 'my-skill');

    expect(sshMocks.acquire).toHaveBeenCalledTimes(1);
    expect(sshMocks.exec).toHaveBeenCalledTimes(2);

    const commands = sshMocks.exec.mock.calls.map(([, command]: [unknown, string]) => String(command));

    expect(commands.every((cmd) => cmd.includes("sudo -u 'alice' bash -lc"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('rm -rf'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('SKILL_ID='))).toBe(true);

    expect(sshMocks.release).toHaveBeenCalledTimes(1);
  });

  it('无效 skillId 时返回 400 错误', async () => {
    const store = new RemoteSkillStore();

    await expect(store.uninstallSkill('alice', '../bad-id')).rejects.toMatchObject({
      name: 'SkillsError',
      statusCode: 400,
      message: '无效的 skillId',
    });

    expect(sshMocks.acquire).not.toHaveBeenCalled();
    expect(sshMocks.exec).not.toHaveBeenCalled();
    expect(sshMocks.release).not.toHaveBeenCalled();
  });

  it('清理状态文件失败时抛出 500 错误并释放连接', async () => {
    sshMocks.exec
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'cleanup failed', exitCode: 1 });

    const store = new RemoteSkillStore();

    const err = await store.uninstallSkill('alice', 'my-skill').catch((e) => e);

    expect(err).toBeInstanceOf(SkillsError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('cleanup failed');

    expect(sshMocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('RemoteSkillStore.listSkillInfos clawhub toggle', () => {
  beforeEach(() => {
    sshMocks.acquire.mockReset();
    sshMocks.release.mockReset();
    sshMocks.exec.mockReset();
    sshMocks.acquire.mockResolvedValue({ id: 'conn-1' });
    delete process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST;
    (RemoteSkillStore as any).catalogCache.clear();
  });

  it('默认不合并 ClawHub 技能', async () => {
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();
    const listAvailableSkills = vi.fn().mockResolvedValue([
      {
        id: 'clawhub-extra',
        name: 'ClawHub Extra',
        description: 'from clawhub',
        trigger: '/clawhub-extra',
        icon: '🌐',
        status: 'available',
        installed: false,
        version: '1.0.0',
        installedVersion: null,
        latestVersion: '1.0.0',
        source: 'clawhub',
        legacy: false,
        enabled: false,
        upgradable: false,
      },
    ]);
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      searchSkills: vi.fn().mockResolvedValue([]),
      listAvailableSkills,
    };

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo '/catalog'")) return ok('/catalog\n');
      if (command.includes('.mycc-manifest.json')) return ok('{}');
      if (command.includes("find '/home/qa/.claude/skills' -mindepth 2 -maxdepth 2 -name SKILL.md")) return ok('');
      if (command.includes("find '/catalog' -mindepth 2 -maxdepth 2 -name SKILL.md")) return ok('');
      return ok('');
    });

    const result = await store.listSkillInfos(linuxUser);

    expect(listAvailableSkills).not.toHaveBeenCalled();
    expect(result.skills.some((skill) => skill.id === 'clawhub-extra')).toBe(false);
  });

  it('开关开启时合并 ClawHub 技能', async () => {
    process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST = 'true';
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();
    const listAvailableSkills = vi.fn().mockResolvedValue([
      {
        id: 'clawhub-extra',
        name: 'ClawHub Extra',
        description: 'from clawhub',
        trigger: '/clawhub-extra',
        icon: '🌐',
        status: 'available',
        installed: false,
        version: '1.0.0',
        installedVersion: null,
        latestVersion: '1.0.0',
        source: 'clawhub',
        legacy: false,
        enabled: false,
        upgradable: false,
      },
    ]);
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      searchSkills: vi.fn().mockResolvedValue([]),
      listAvailableSkills,
    };

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo '/catalog'")) return ok('/catalog\n');
      if (command.includes('.mycc-manifest.json')) return ok('{}');
      if (command.includes("find '/home/qa/.claude/skills' -mindepth 2 -maxdepth 2 -name SKILL.md")) return ok('');
      if (command.includes("find '/catalog' -mindepth 2 -maxdepth 2 -name SKILL.md")) return ok('');
      return ok('');
    });

    const result = await store.listSkillInfos(linuxUser);

    expect(listAvailableSkills).toHaveBeenCalledTimes(1);
    expect(result.skills.some((skill) => skill.id === 'clawhub-extra')).toBe(true);
  });
});

describe('RemoteSkillStore.searchSkills catalog scope', () => {
  it('registry 未命中时返回空结果且不回退 ClawHub', async () => {
    const store = new RemoteSkillStore();
    const searchSkills = vi.fn().mockResolvedValue([
      {
        id: 'tushare-tools',
        name: 'Tushare Tools',
        description: 'from clawhub',
        trigger: '/tushare-tools',
        icon: '🌐',
        status: 'available',
        installed: false,
        version: '1.0.0',
        installedVersion: null,
        latestVersion: '1.0.0',
        source: 'clawhub',
        legacy: false,
        enabled: false,
        upgradable: false,
      },
    ]);
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills,
    };

    const results = await store.searchSkills('qa', 'tushare');

    expect(searchSkills).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('registry 命中时不调用 ClawHub', async () => {
    const store = new RemoteSkillStore();
    const searchSkills = vi.fn().mockResolvedValue([]);
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills,
    };

    const results = await store.searchSkills('qa', 'deep');

    expect(results.some((item) => item.id === 'deep-research')).toBe(true);
    expect(searchSkills).not.toHaveBeenCalled();
  });

  it('支持按非斜杠触发词搜索 registry 技能', async () => {
    const store = new RemoteSkillStore();

    const results = await store.searchSkills('qa', '访问网站');

    expect(results).toContainEqual(expect.objectContaining({
      id: 'browser-use',
      trigger: '/browser-use',
      triggers: expect.arrayContaining(['/browser-use', '访问网站']),
    }));
  });
});

describe('RemoteSkillStore.listSkillInfos perf guard', () => {
  beforeEach(() => {
    sshMocks.acquire.mockReset();
    sshMocks.release.mockReset();
    sshMocks.exec.mockReset();
    sshMocks.acquire.mockResolvedValue({ id: 'conn-1' });
    delete process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST;
    (RemoteSkillStore as any).catalogCache.clear();
  });

  it('registry 已知且未安装技能不读取远端 SKILL.md', async () => {
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo '/catalog'")) return ok('/catalog\n');
      if (command.includes('.mycc-manifest.json')) return ok('{}');
      if (command.includes("find '/home/qa/.claude/skills' -mindepth 2 -maxdepth 2 -name SKILL.md")) return ok('');
      if (command.includes("find '/catalog' -mindepth 2 -maxdepth 2 -name SKILL.md")) {
        return ok('/catalog/deep-research/SKILL.md\n');
      }
      return ok('');
    });

    const result = await store.listSkillInfos(linuxUser);

    expect(result.skills.some((skill) => skill.id === 'deep-research')).toBe(true);
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes("cat '/catalog/deep-research/SKILL.md'")
      )
    ).toBe(false);
  });

  it('registry 已知技能缺少 SKILL.md version 时使用 registry 默认版本', async () => {
    const store = new RemoteSkillStore();

    const result = await (store as any).readSkillInfo(
      async () => ok(skillMdWithoutVersion()),
      '/catalog/deep-research/SKILL.md',
      'catalog',
      'available'
    );

    expect(result).toMatchObject({
      id: 'deep-research',
      assistantSkillName: 'deep-research',
      version: '1.0.0',
      latestVersion: '1.0.0',
      legacy: false,
    });
  });

  it('按 Claude skill name 安装的目录仍映射回市场 id', async () => {
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo ok || true")) return ok('ok\n');
      if (command.includes('.mycc-manifest.json')) {
        return ok('{"skills":{"browser":{"version":"2.0.0","source":"catalog","disabled":false}}}');
      }
      if (command.includes('/home/qa/.claude/skills') && command.includes('-name SKILL.md')) {
        return ok('/home/qa/.claude/skills/webapp-testing/SKILL.md\n');
      }
      if (command.includes('/catalog') && command.includes('-name SKILL.md')) {
        return ok('/catalog/browser/SKILL.md\n');
      }
      if (hasCat(command, '/catalog/browser/SKILL.md')) {
        return ok('---\nname: webapp-testing\nversion: 2.0.0\n---\n');
      }
      if (hasCat(command, '/home/qa/.claude/skills/webapp-testing/SKILL.md')) {
        return ok('---\nname: webapp-testing\nversion: 2.0.0\n---\n');
      }
      return ok('');
    });

    const result = await store.listSkillInfos(linuxUser);
    const browser = result.skills.find((skill) => skill.id === 'browser');

    expect(browser).toMatchObject({
      id: 'browser',
      assistantSkillName: 'webapp-testing',
      installed: true,
      status: 'installed',
      version: '2.0.0',
    });
  });
});

describe('RemoteSkillStore.listSkillInfos auto-seed first load', () => {
  beforeEach(() => {
    sshMocks.acquire.mockReset();
    sshMocks.release.mockReset();
    sshMocks.exec.mockReset();
    sshMocks.acquire.mockResolvedValue({ id: 'conn-1' });
    delete process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST;
    (RemoteSkillStore as any).catalogCache.clear();
  });

  it('auto-seed 后首刷已安装内置技能版本与状态正确', async () => {
    const linuxUser = 'qa';
    const store = new RemoteSkillStore();

    (RemoteSkillStore as any).catalogCache.set(linuxUser, {
      path: '/catalog',
      expiresAt: Date.now() + 60_000,
    });

    let installedFindCount = 0;
    let manifestReadCount = 0;
    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (command.includes("[ -d '/catalog' ] && echo ok || true")) return ok('ok\n');
      if (command.includes('.mycc-manifest.json')) {
        manifestReadCount += 1;
        return manifestReadCount === 1
          ? ok('')
          : ok('{"skills":{"browser":{"version":"1.2.3","source":"catalog","disabled":false}}}');
      }
      if (command.includes('/home/qa/.claude/skills') && command.includes('-name SKILL.md')) {
        installedFindCount += 1;
        return installedFindCount === 1 ? ok('') : ok('/home/qa/.claude/skills/browser/SKILL.md\n');
      }
      if (command.includes('/catalog') && command.includes('-name SKILL.md')) {
        return ok('/catalog/browser/SKILL.md\n');
      }
      if (hasDirCheck(command, '/catalog/browser')) {
        return ok('ok\n');
      }
      if (hasDirCheck(command, '/home/qa/.claude/skills/browser')) {
        return ok('');
      }
      if (command.includes("cp -a '/catalog/browser' '/home/qa/.claude/skills/browser'")) {
        return ok('');
      }
      if (hasCat(command, '/catalog/browser/SKILL.md')) {
        return ok(skillMd('1.2.3'));
      }
      if (command.includes("MANIFEST='/home/qa/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const result = await store.listSkillInfos(linuxUser);
    const deepResearch = result.skills.find((skill) => skill.id === 'browser');

    expect(deepResearch).toMatchObject({
      status: 'installed',
      installed: true,
      version: '1.2.3',
      installedVersion: '1.2.3',
      latestVersion: '1.2.3',
      enabled: true,
      upgradable: false,
    });
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes("cat '/catalog/browser/SKILL.md'")
      )
    ).toBe(true);
  });
});
