/**
 * VPS 用户管理器
 * 负责在 VPS 上创建、检查、删除 Linux 用户
 */

import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername, escapeShellArg } from '../utils/validation.js';

export class VPSUserManager {
  /**
   * 将模板文件复制到用户 workspace 并替换变量
   *
   * 注意：linuxUser 已通过 sanitizeLinuxUsername 校验，可安全用于路径拼接。
   * escapeShellArg 仅用于命令参数。
   */
  private async initWorkspace(
    connection: any,
    linuxUser: string,
    nickname: string
  ): Promise<void> {
    const sshPool = getSSHPool();
    const templateDir = '/opt/mycc/templates/user-workspace';
    const workspaceDir = `/home/${linuxUser}/workspace`;

    // 1. 确保模板目录存在
    const checkCmd = `sudo test -d ${templateDir}`;
    const checkResult = await sshPool.exec(connection, checkCmd);
    if (checkResult.exitCode !== 0) {
      throw new Error(`模板目录不存在: ${templateDir}`);
    }

    // 2. 复制模板文件
    const copyCmd = `sudo cp -r ${templateDir}/. ${workspaceDir}/`;
    const copyResult = await sshPool.exec(connection, copyCmd);
    if (copyResult.exitCode !== 0) {
      throw new Error(`复制模板失败: ${copyResult.stderr}`);
    }

    // 3. 替换变量 {{USERNAME}}
    const safeNickname = nickname.replace(/[/&\\]/g, '\\$&');
    const sedCmd = `sudo find ${workspaceDir} -type f \\( -name '*.md' -o -name '*.json' \\) -exec sed -i 's/{{USERNAME}}/${safeNickname}/g' {} +`;
    const sedResult = await sshPool.exec(connection, sedCmd);
    if (sedResult.exitCode !== 0) {
      console.warn(`⚠️ 变量替换部分失败: ${sedResult.stderr}`);
    }

    // 4. 设置文件归属
    const chownCmd = `sudo chown -R ${linuxUser}:mycc /home/${linuxUser}`;
    const chownResult = await sshPool.exec(connection, chownCmd);
    if (chownResult.exitCode !== 0) {
      throw new Error(`设置文件权限失败: ${chownResult.stderr}`);
    }
  }

  /**
   * 检查用户是否存在
   */
  async userExists(linuxUser: string): Promise<boolean> {
    // 验证用户名格式
    sanitizeLinuxUsername(linuxUser);

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const result = await sshPool.exec(connection, `id ${escapeShellArg(linuxUser)}`);
      return result.exitCode === 0;
    } catch (err) {
      return false;
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 创建用户
   * 1. 创建 Linux 用户（加入 mycc 组）
   * 2. 创建工作目录 /home/{linuxUser}/workspace
   * 3. 配置 sudoers（允许执行 claude 命令）
   */
  async createUser(linuxUser: string, nickname: string = '用户'): Promise<void> {
    // 验证用户名格式
    sanitizeLinuxUsername(linuxUser);

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      console.log(`[VPSUserManager] 开始创建用户: ${linuxUser}`);

      // 1. 创建用户（加入 mycc 组）
      const createUserCmd = `sudo useradd -m -g mycc -s /bin/bash ${escapeShellArg(linuxUser)}`;
      const createResult = await sshPool.exec(connection, createUserCmd);

      if (createResult.exitCode !== 0) {
        throw new Error(`创建用户失败: ${createResult.stderr}`);
      }

      // 2. 创建基础工作目录（模板复制前保证目标目录存在）
      const mkdirCmd = `sudo mkdir -p /home/${linuxUser}/workspace`;
      const mkdirResult = await sshPool.exec(connection, mkdirCmd);

      if (mkdirResult.exitCode !== 0) {
        throw new Error(`创建工作目录失败: ${mkdirResult.stderr}`);
      }

      // 3. 初始化 workspace（复制模板 + 替换变量 + 设置权限）
      await this.initWorkspace(connection, linuxUser, nickname);

      console.log(`✅ VPS 用户创建成功: ${linuxUser}`);
    } catch (err) {
      console.error(`❌ 创建 VPS 用户失败:`, err);
      throw err;
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 删除用户（管理用）
   */
  async deleteUser(linuxUser: string): Promise<void> {
    // 验证用户名格式
    sanitizeLinuxUsername(linuxUser);

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      console.log(`[VPSUserManager] 开始删除用户: ${linuxUser}`);

      // 删除用户及其 home 目录
      const deleteCmd = `sudo userdel -r ${escapeShellArg(linuxUser)}`;
      const result = await sshPool.exec(connection, deleteCmd);

      if (result.exitCode !== 0) {
        throw new Error(`删除用户失败: ${result.stderr}`);
      }

      console.log(`✅ VPS 用户删除成功: ${linuxUser}`);
    } catch (err) {
      console.error(`❌ 删除 VPS 用户失败:`, err);
      throw err;
    } finally {
      sshPool.release(connection);
    }
  }
}

// 全局实例
export const vpsUserManager = new VPSUserManager();
