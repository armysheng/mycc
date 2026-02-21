import { validateLinuxUsername } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import { RemoteSkillStore } from './remote-skill-store.js';
import type { ISkillsService } from './contracts.js';
import type { InstallSkillResult, SkillActionResult, SkillsContext, SkillsListResult } from './types.js';

const LIST_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 250;

export class SkillsService implements ISkillsService {
  constructor(private readonly store: RemoteSkillStore) {}

  async listSkills(context: SkillsContext): Promise<SkillsListResult> {
    this.validateContext(context);
    const result = await this.executeSkillOperation(
      () => this.store.listSkillInfos(context.linuxUser),
      LIST_TIMEOUT_MS,
      '技能列表加载超时，请稍后重试'
    );
    return {
      skills: result.skills,
      total: result.skills.length,
      catalogAvailable: result.catalogAvailable,
    };
  }

  async installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult> {
    this.validateContext(context);
    if (!/^[a-zA-Z0-9_-]+$/.test(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }
    const version = await this.executeSkillOperation(
      () => this.store.installSkill(context.linuxUser, skillId),
      ACTION_TIMEOUT_MS,
      '安装技能超时，请稍后重试'
    );
    return {
      skillId,
      installed: true,
      version,
    };
  }

  async upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    const version = await this.executeSkillOperation(
      () => this.store.upgradeSkill(context.linuxUser, skillId),
      ACTION_TIMEOUT_MS,
      '升级技能超时，请稍后重试'
    );
    return { skillId, success: true, version };
  }

  async enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.setSkillEnabled(context.linuxUser, skillId, true),
      ACTION_TIMEOUT_MS,
      '启用技能超时，请稍后重试'
    );
    return { skillId, success: true, enabled: true };
  }

  async disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.setSkillEnabled(context.linuxUser, skillId, false),
      ACTION_TIMEOUT_MS,
      '禁用技能超时，请稍后重试'
    );
    return { skillId, success: true, enabled: false };
  }

  private validateContext(context: SkillsContext): void {
    if (!context.userId || !context.linuxUser) {
      throw new SkillsError(400, '用户上下文不完整');
    }
    if (!validateLinuxUsername(context.linuxUser)) {
      throw new SkillsError(400, '无效的用户名格式');
    }
  }

  private validateSkillId(skillId: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }
  }

  private async executeSkillOperation<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return this.withOperationTimeout(
      () => this.withTransientRetry(fn),
      timeoutMs,
      timeoutMessage
    );
  }

  private async withOperationTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new SkillsError(504, timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async withTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (!this.isServiceUnavailableError(err)) {
          throw err;
        }

        if (attempt === 0 && this.isRetryableTransientError(err)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        throw this.toServiceUnavailableError(err);
      }
    }

    throw new SkillsError(503, '技能服务暂时不可用，请稍后重试');
  }

  private isRetryableTransientError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('Not connected') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('EPIPE')
    );
  }

  private isServiceUnavailableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      this.isRetryableTransientError(err) ||
      msg.includes('Timeout waiting for SSH connection') ||
      msg.includes('命令执行超时')
    );
  }

  private toServiceUnavailableError(err: unknown): SkillsError {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Timeout waiting for SSH connection') || msg.includes('命令执行超时')) {
      return new SkillsError(503, '技能服务连接超时，请稍后重试');
    }
    return new SkillsError(503, '技能服务暂时不可用，请稍后重试');
  }
}
