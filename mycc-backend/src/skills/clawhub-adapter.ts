/**
 * ClawHub 技能注册中心适配器
 * 通过 SSH 在 VPS 上执行 clawdhub CLI
 */

import matter from 'gray-matter';
import { getSSHPool } from '../ssh/pool.js';
import { escapeShellArg } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import type { SkillInfo } from './types.js';
import type { SSHConnection } from '../ssh/types.js';

type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;

const CLAWHUB_CLI_PATH = '~/.npm-global/bin/clawdhub';

function normalizeVersion(input: unknown): { version: string; legacy: boolean } {
  if (typeof input === 'string' && /^\d+\.\d+\.\d+([-.][a-zA-Z0-9.]+)?$/.test(input.trim())) {
    return { version: input.trim(), legacy: false };
  }
  return { version: '0.0.0-legacy', legacy: true };
}

function userSkillsDir(linuxUser: string): string {
  return `/home/${linuxUser}/workspace/.claude/skills`;
}

function runAsLinuxUserCommand(linuxUser: string, command: string): string {
  return `sudo -u ${escapeShellArg(linuxUser)} bash -lc ${escapeShellArg(command)}`;
}

export class ClawHubAdapter {
  /**
   * 列出 ClawHub 上可用的技能
   */
  async listAvailableSkills(linuxUser: string): Promise<SkillInfo[]> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      // 执行 clawdhub list 获取已安装的技能
      const listResult = await runAsUser(`${CLAWHUB_CLI_PATH} list 2>&1`);

      if (listResult.exitCode !== 0) {
        console.warn('[ClawHub] list 命令失败:', listResult.stderr);
        return [];
      }

      const skills: SkillInfo[] = [];
      const lines = listResult.stdout.trim().split('\n');

      for (const line of lines) {
        // 解析格式: "skill-name  version"
        const match = line.match(/^(\S+)\s+(\S+)$/);
        if (!match) continue;

        const [, skillId, version] = match;

        // 获取技能详情
        const inspectResult = await runAsUser(`${CLAWHUB_CLI_PATH} inspect ${escapeShellArg(skillId)} 2>&1`);

        if (inspectResult.exitCode !== 0) {
          console.warn(`[ClawHub] inspect ${skillId} 失败:`, inspectResult.stderr);
          continue;
        }

        // 解析 inspect 输出
        const skillInfo = this.parseInspectOutput(skillId, inspectResult.stdout, version);
        if (skillInfo) {
          skills.push(skillInfo);
        }
      }

      return skills;
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 搜索 ClawHub 技能
   */
  async searchSkills(linuxUser: string, query: string): Promise<SkillInfo[]> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      const searchResult = await runAsUser(`${CLAWHUB_CLI_PATH} search ${escapeShellArg(query)} 2>&1`);

      if (searchResult.exitCode !== 0) {
        console.warn('[ClawHub] search 命令失败:', searchResult.stderr);
        return [];
      }

      // 解析搜索结果（格式类似 list）
      const skills: SkillInfo[] = [];
      const lines = searchResult.stdout.trim().split('\n');

      for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\S+)$/);
        if (!match) continue;

        const [, skillId, version] = match;
        const inspectResult = await runAsUser(`${CLAWHUB_CLI_PATH} inspect ${escapeShellArg(skillId)} 2>&1`);

        if (inspectResult.exitCode === 0) {
          const skillInfo = this.parseInspectOutput(skillId, inspectResult.stdout, version);
          if (skillInfo) {
            skills.push(skillInfo);
          }
        }
      }

      return skills;
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 安装 ClawHub 技能
   */
  async installSkill(linuxUser: string, skillId: string): Promise<string> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      const targetDir = userSkillsDir(linuxUser);

      // 执行 clawdhub install
      const installCmd = `cd ${escapeShellArg(targetDir)} && ${CLAWHUB_CLI_PATH} install ${escapeShellArg(skillId)} 2>&1`;
      const installResult = await runAsUser(installCmd);

      if (installResult.exitCode !== 0) {
        throw new SkillsError(500, `安装失败: ${installResult.stderr || installResult.stdout}`);
      }

      // 读取安装后的版本
      const skillFile = `${targetDir}/${skillId}/SKILL.md`;
      const catResult = await runAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);

      if (catResult.stdout) {
        const parsed = matter(catResult.stdout);
        const versionInfo = normalizeVersion(parsed.data.version);
        return versionInfo.version;
      }

      return '1.0.0';
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 更新 ClawHub 技能
   */
  async upgradeSkill(linuxUser: string, skillId: string): Promise<string> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      const targetDir = userSkillsDir(linuxUser);

      // 执行 clawdhub update
      const updateCmd = `cd ${escapeShellArg(targetDir)} && ${CLAWHUB_CLI_PATH} update ${escapeShellArg(skillId)} 2>&1`;
      const updateResult = await runAsUser(updateCmd);

      if (updateResult.exitCode !== 0) {
        throw new SkillsError(500, `更新失败: ${updateResult.stderr || updateResult.stdout}`);
      }

      // 读取更新后的版本
      const skillFile = `${targetDir}/${skillId}/SKILL.md`;
      const catResult = await runAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);

      if (catResult.stdout) {
        const parsed = matter(catResult.stdout);
        const versionInfo = normalizeVersion(parsed.data.version);
        return versionInfo.version;
      }

      return '1.0.0';
    } finally {
      sshPool.release(connection);
    }
  }

  /**
   * 解析 clawdhub inspect 输出
   */
  private parseInspectOutput(skillId: string, output: string, version: string): SkillInfo | null {
    try {
      // 解析 inspect 输出格式:
      // - Fetching skill
      // skill-name  Display Name
      // Summary: description text
      // Owner: username
      // Created: date
      // Updated: date
      // Latest: version
      // Tags: ...

      const lines = output.split('\n');
      let name = skillId;
      let description = '';

      for (const line of lines) {
        if (line.includes('Summary:')) {
          description = line.replace(/^.*Summary:\s*/, '').trim();
        }
        // 第二行通常是 "skill-name  Display Name"
        const nameMatch = line.match(/^(\S+)\s+(.+)$/);
        if (nameMatch && nameMatch[1] === skillId) {
          name = nameMatch[2].trim();
        }
      }

      return {
        id: skillId,
        name: name || skillId,
        description: description || '',
        trigger: `/${skillId}`,
        icon: '🌐', // ClawHub 技能统一用地球图标
        status: 'available',
        installed: false,
        version: version,
        installedVersion: null,
        latestVersion: version,
        source: 'clawhub',
        legacy: false,
        enabled: false,
        upgradable: false,
      };
    } catch (error) {
      console.warn(`[ClawHub] 解析 inspect 输出失败:`, error);
      return null;
    }
  }
}
