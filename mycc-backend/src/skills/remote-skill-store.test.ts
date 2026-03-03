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

  it('installSkill: 首个 catalog 无目标 skill，后续候选存在时可安装', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new RemoteSkillStore();
    (store as any).clawhubAdapter = {
      installSkill: vi.fn().mockRejectedValue(new Error('skip clawhub')),
      upgradeSkill: vi.fn(),
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills: vi.fn().mockResolvedValue([]),
    };

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (hasDirCheck(command, '/home/qa/workspace/.claude/skills/tell-me')) {
        return ok('');
      }
      if (command.includes("[ -d '/opt/mycc/.claude/skills' ] && echo '/opt/mycc/.claude/skills' || true")) {
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
        command.includes('/home/qa/workspace/.claude/skills/tell-me')
      ) {
        return ok('');
      }
      if (hasCat(command, '/home/qa/workspace/.claude/skills/tell-me/SKILL.md')) {
        return ok(skillMd('1.2.3'));
      }
      if (command.includes("MANIFEST='/home/qa/workspace/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const version = await store.installSkill('qa', 'tell-me');

    expect(version).toBe('1.2.3');
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('cp -a') && command.includes('/opt/mycc/mycc/.claude/skills/tell-me')
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it('upgradeSkill: 首个 catalog 无目标 skill，后续候选存在时可升级', async () => {
    const store = new RemoteSkillStore();
    (store as any).clawhubAdapter = {
      installSkill: vi.fn(),
      upgradeSkill: vi.fn(),
      listAvailableSkills: vi.fn().mockResolvedValue([]),
      searchSkills: vi.fn().mockResolvedValue([]),
    };

    sshMocks.exec.mockImplementation(async (_connection: unknown, command: string): Promise<ExecResult> => {
      if (hasDirCheck(command, '/home/qa/workspace/.claude/skills/scheduler')) {
        return ok('ok\n');
      }
      if (hasCat(command, '/home/qa/workspace/.claude/skills/.mycc-manifest.json')) {
        return ok('{"skills":{"scheduler":{"source":"catalog","disabled":false}}}');
      }
      if (command.includes("[ -d '/opt/mycc/.claude/skills' ] && echo '/opt/mycc/.claude/skills' || true")) {
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
        command.includes('/home/qa/workspace/.claude/skills/scheduler') &&
        command.includes('/opt/mycc/mycc/.claude/skills/scheduler')
      ) {
        return ok('');
      }
      if (hasCat(command, '/home/qa/workspace/.claude/skills/scheduler/SKILL.md')) {
        return ok(skillMd('2.0.0'));
      }
      if (command.includes("MANIFEST='/home/qa/workspace/.claude/skills/.mycc-manifest.json'")) {
        return ok('');
      }
      return ok('');
    });

    const version = await store.upgradeSkill('qa', 'scheduler');

    expect(version).toBe('2.0.0');
    expect(
      sshMocks.exec.mock.calls.some(([, command]: [unknown, string]) =>
        command.includes('rm -rf') && command.includes('/opt/mycc/mycc/.claude/skills/scheduler')
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
