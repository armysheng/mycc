import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsError } from './errors.js';

const mocks = vi.hoisted(() => {
  const exec = vi.fn();
  const acquire = vi.fn();
  const release = vi.fn();
  const connection = { id: 'conn-1' };

  return {
    exec,
    acquire,
    release,
    connection,
  };
});

vi.mock('../ssh/pool.js', () => ({
  getSSHPool: () => ({
    acquire: mocks.acquire,
    exec: mocks.exec,
    release: mocks.release,
  }),
}));

import { RemoteSkillStore } from './remote-skill-store.js';

describe('RemoteSkillStore.uninstallSkill', () => {
  beforeEach(() => {
    mocks.exec.mockReset();
    mocks.acquire.mockReset();
    mocks.release.mockReset();

    mocks.acquire.mockResolvedValue(mocks.connection);
    mocks.exec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('删除技能目录并清理 manifest/lock', async () => {
    const store = new RemoteSkillStore();

    await store.uninstallSkill('alice', 'my-skill');

    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(mocks.exec).toHaveBeenCalledTimes(2);

    const commands = mocks.exec.mock.calls.map(([, command]) => String(command));

    expect(commands.every((cmd) => cmd.includes("sudo -u 'alice' bash -lc"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('rm -rf'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('SKILL_ID='))).toBe(true);

    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledWith(mocks.connection);
  });

  it('无效 skillId 时返回 400 错误', async () => {
    const store = new RemoteSkillStore();

    await expect(store.uninstallSkill('alice', '../bad-id')).rejects.toMatchObject({
      name: 'SkillsError',
      statusCode: 400,
      message: '无效的 skillId',
    });

    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('清理状态文件失败时抛出 500 错误并释放连接', async () => {
    mocks.exec
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'cleanup failed', exitCode: 1 });

    const store = new RemoteSkillStore();

    const err = await store.uninstallSkill('alice', 'my-skill').catch((e) => e);

    expect(err).toBeInstanceOf(SkillsError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('cleanup failed');

    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledWith(mocks.connection);
  });
});
