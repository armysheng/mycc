import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLinuxUsername } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import { RemoteSkillStore } from './remote-skill-store.js';
import { getAssistantSkillNameForSkill, getImageMetadataForSkill, getMarketSkills as registryMarketSkills, getReadySkills as registryReadySkills, getSkillById, getTriggersForSkill, getVersionForSkill } from './skill-registry.js';
import { getSkillStatsMap, recordSkillEvent } from './skill-events.js';
import type { ISkillsService } from './contracts.js';
import type { InstallSkillResult, SkillActionResult, SkillDetailResult, SkillsContext, SkillsListResult, SkillInfo, SkillDefinition, SkillEventType, SkillStats } from './types.js';

const LIST_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 250;
const SSH_RUNTIME_UNAVAILABLE_MESSAGE = '技能运行环境尚未就绪，请稍后重试';
const parsedSkillsListCacheTtl = Number.parseInt(process.env.SKILLS_LIST_CACHE_TTL_MS || '10000', 10);
const LIST_CACHE_TTL_MS = Number.isFinite(parsedSkillsListCacheTtl) && parsedSkillsListCacheTtl > 0
  ? parsedSkillsListCacheTtl
  : 10_000;
const DETAIL_CONTENT_MAX_CHARS = 16_000;
const runtimeCatalogDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog');

type CachedListResult = {
  data: SkillsListResult;
  expiresAt: number;
};

type SkillsServiceOptions = {
  resolveInstallLinuxUser?: (context: SkillsContext) => string;
};

const ZERO_SKILL_STATS: SkillStats = {
  downloads: 0,
  installs: 0,
  updates: 0,
  uses: 0,
};

export class SkillsService implements ISkillsService {
  private static listInFlight = new Map<string, Promise<SkillsListResult>>();
  private static listCache = new Map<string, CachedListResult>();

  constructor(
    private readonly store: RemoteSkillStore,
    private readonly options: SkillsServiceOptions = {},
  ) {}

  getMarketSkills(): SkillDefinition[] {
    return registryMarketSkills();
  }

  async ensureBuiltinSkills(context: SkillsContext): Promise<number> {
    this.validateContext(context);
    const seeded = await this.executeSkillOperation(
      () => this.store.ensureBuiltinSkills(context),
      ACTION_TIMEOUT_MS,
      '内置技能初始化超时，请稍后重试'
    );
    this.invalidateUserListCache(context.linuxUser);
    return seeded;
  }

  async listSkills(context: SkillsContext): Promise<SkillsListResult> {
    this.validateContext(context);
    const cacheKey = context.linuxUser;
    const cached = SkillsService.listCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const existing = SkillsService.listInFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const pending = this.executeSkillOperation(
      () => this.store.listSkillInfos(context),
      LIST_TIMEOUT_MS,
      '技能列表加载超时，请稍后重试'
    )
      .then((result) => {
        const skillIds = result.skills.map((skill) => skill.id);
        return this.getStatsForSkills(skillIds).then((statsMap) => ({
          result,
          statsMap,
        }));
      })
      .then(({ result, statsMap }) => {
        const data = {
          skills: result.skills.map((skill) => ({
            ...skill,
            ...getImageMetadataForSkill(skill.id),
            stats: statsMap.get(skill.id) || ZERO_SKILL_STATS,
          })),
          total: result.skills.length,
          catalogAvailable: result.catalogAvailable,
          installRootPath: this.getInstallRootPath(context),
        };
        SkillsService.listCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + LIST_CACHE_TTL_MS,
        });
        return data;
      })
      .catch((err) => {
        if (!this.isSshRuntimeUnavailableError(err)) {
          throw err;
        }

        const data = this.buildRegistryFallbackList(context);
        SkillsService.listCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + LIST_CACHE_TTL_MS,
        });
        return data;
      })
      .finally(() => {
        SkillsService.listInFlight.delete(cacheKey);
      });

    SkillsService.listInFlight.set(cacheKey, pending);
    return pending;
  }

  async getSkillDetail(context: SkillsContext, skillId: string): Promise<SkillDetailResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);

    const list = await this.listSkills(context);
    const skill = list.skills.find((item) => item.id === skillId);
    const definition = getSkillById(skillId);

    if (!skill && !definition) {
      throw new SkillsError(404, '技能不存在');
    }

    const resolvedSkill = skill || this.buildRegistrySkillInfo(definition!);
    const preview = await this.readSkillContentPreview(definition, resolvedSkill);

    return {
      skill: resolvedSkill,
      installTargetPath: this.getInstallTargetPath(context, skillId),
      ...(definition
        ? {
            definition: {
              builtin: definition.builtin,
              readiness: definition.readiness,
              riskLevel: definition.riskLevel,
              deps: definition.deps,
              defaultEnabled: definition.defaultEnabled,
              mdPath: definition.mdPath,
              sourceUrl: definition.source_url,
              originType: definition.origin_type,
              validationNote: definition.validation_note,
              lastVerifiedAt: definition.last_verified_at,
            },
          }
        : {}),
      contentPreview: preview,
    };
  }

  async searchSkills(context: SkillsContext, query: string): Promise<SkillInfo[]> {
    this.validateContext(context);
    return this.executeSkillOperation(
      () => this.store.searchSkills(context.linuxUser, query),
      LIST_TIMEOUT_MS,
      '搜索技能超时，请稍后重试'
    );
  }

  async subscribeSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult> {
    return this.installSkill(context, skillId);
  }

  async installSkill(context: SkillsContext, skillId: string): Promise<InstallSkillResult> {
    this.validateContext(context);
    if (!/^[a-zA-Z0-9_-]+$/.test(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }
    await this.recordEventBestEffort({
      userId: context.userId,
      skillId,
      eventType: 'download',
    });
    let result;
    try {
      result = await this.executeSkillOperation(
        () => this.store.installSkill(context, skillId),
        ACTION_TIMEOUT_MS,
        '安装技能超时，请稍后重试'
      );
    } catch (err) {
      await this.recordEventBestEffort({
        userId: context.userId,
        skillId,
        eventType: 'install_failed',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
    await this.recordEventBestEffort({
      userId: context.userId,
      skillId,
      eventType: 'install',
      version: result.version,
      source: result.source,
      targetPath: result.targetPath,
    });
    this.invalidateUserListCache(context.linuxUser);
    return {
      skillId,
      installed: true,
      version: result.version,
      source: result.source,
      targetPath: result.targetPath,
    };
  }

  async upgradeSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    let result;
    try {
      result = await this.executeSkillOperation(
        () => this.store.upgradeSkill(context, skillId),
        ACTION_TIMEOUT_MS,
        '升级技能超时，请稍后重试'
      );
    } catch (err) {
      await this.recordEventBestEffort({
        userId: context.userId,
        skillId,
        eventType: 'update_failed',
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
    await this.recordEventBestEffort({
      userId: context.userId,
      skillId,
      eventType: 'update',
      version: result.version,
      source: result.source,
      targetPath: result.targetPath,
    });
    this.invalidateUserListCache(context.linuxUser);
    return {
      skillId,
      success: true,
      version: result.version,
      source: result.source,
      targetPath: result.targetPath,
    };
  }

  async enableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.setSkillEnabled(context, skillId, true),
      ACTION_TIMEOUT_MS,
      '启用技能超时，请稍后重试'
    );
    this.invalidateUserListCache(context.linuxUser);
    return { skillId, success: true, enabled: true };
  }

  async disableSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.setSkillEnabled(context, skillId, false),
      ACTION_TIMEOUT_MS,
      '禁用技能超时，请稍后重试'
    );
    this.invalidateUserListCache(context.linuxUser);
    return { skillId, success: true, enabled: false };
  }

  async uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.uninstallSkill(context, skillId),
      ACTION_TIMEOUT_MS,
      '卸载技能超时，请稍后重试'
    );
    await this.recordEventBestEffort({
      userId: context.userId,
      skillId,
      eventType: 'uninstall',
    });
    this.invalidateUserListCache(context.linuxUser);
    return { skillId, success: true, uninstalled: true };
  }

  async useSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.recordEventBestEffort({
      userId: context.userId,
      skillId,
      eventType: 'use',
    });
    this.invalidateUserListCache(context.linuxUser);
    return { skillId, success: true };
  }

  private invalidateUserListCache(linuxUser: string): void {
    SkillsService.listCache.delete(linuxUser);
    SkillsService.listInFlight.delete(linuxUser);
  }

  private getInstallTargetPath(context: SkillsContext, skillId: string): string {
    return `${this.getInstallRootPath(context)}/${getAssistantSkillNameForSkill(skillId)}`;
  }

  private getInstallRootPath(context: SkillsContext): string {
    const installLinuxUser = this.options.resolveInstallLinuxUser?.(context) || context.linuxUser;
    return `/home/${installLinuxUser}/.claude/skills`;
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

  private buildRegistryFallbackList(context: SkillsContext): SkillsListResult {
    const skills: SkillInfo[] = registryReadySkills().map((skill) => ({
      id: skill.id,
      assistantSkillName: getAssistantSkillNameForSkill(skill.id),
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      triggers: getTriggersForSkill(skill.id),
      ...getImageMetadataForSkill(skill.id),
      icon: skill.icon,
      status: 'available',
      installed: false,
      version: getVersionForSkill(skill.id),
      installedVersion: null,
      latestVersion: getVersionForSkill(skill.id),
      source: 'registry',
      legacy: false,
      enabled: false,
      upgradable: false,
      category: skill.category,
      owner: skill.owner,
      stats: ZERO_SKILL_STATS,
    }));

    return {
      skills,
      total: skills.length,
      catalogAvailable: false,
      installRootPath: this.getInstallRootPath(context),
    };
  }

  private buildRegistrySkillInfo(skill: SkillDefinition): SkillInfo {
    return {
      id: skill.id,
      assistantSkillName: getAssistantSkillNameForSkill(skill.id),
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      triggers: getTriggersForSkill(skill.id),
      ...getImageMetadataForSkill(skill.id),
      icon: skill.icon,
      status: 'available',
      installed: false,
      version: getVersionForSkill(skill.id),
      installedVersion: null,
      latestVersion: getVersionForSkill(skill.id),
      source: 'registry',
      legacy: false,
      enabled: false,
      upgradable: false,
      category: skill.category,
      owner: skill.owner,
      stats: ZERO_SKILL_STATS,
    };
  }

  private async readSkillContentPreview(
    definition: SkillDefinition | undefined,
    skill: SkillInfo,
  ): Promise<SkillDetailResult['contentPreview']> {
    if (definition) {
      const safePath = path.normalize(definition.mdPath);
      const absolutePath = path.join(runtimeCatalogDir, safePath);
      if (absolutePath.startsWith(runtimeCatalogDir)) {
        try {
          const content = await readFile(absolutePath, 'utf8');
          return {
            source: 'catalog',
            path: definition.mdPath,
            content: content.slice(0, DETAIL_CONTENT_MAX_CHARS),
            truncated: content.length > DETAIL_CONTENT_MAX_CHARS,
          };
        } catch {
          // Fall through to a generated preview when catalog content is unavailable.
        }
      }
    }

    return {
      source: 'generated',
      path: `${skill.assistantSkillName || skill.id}/SKILL.md`,
      content: [
        `name: ${skill.name}`,
        '',
        'description',
        skill.description || '暂无说明',
        '',
        'triggers',
        ...(skill.triggers?.length ? skill.triggers : [skill.trigger]).map((trigger) => `- ${trigger}`),
      ].join('\n'),
      truncated: false,
    };
  }

  private async getStatsForSkills(skillIds: string): Promise<Map<string, SkillStats>>;
  private async getStatsForSkills(skillIds: string[]): Promise<Map<string, SkillStats>>;
  private async getStatsForSkills(skillIds: string | string[]): Promise<Map<string, SkillStats>> {
    const ids = Array.isArray(skillIds) ? skillIds : [skillIds];
    try {
      return await getSkillStatsMap(ids);
    } catch (err) {
      console.warn('[SkillsService] 技能统计加载失败:', err);
      return new Map();
    }
  }

  private async recordEventBestEffort(input: {
    userId: number;
    skillId: string;
    eventType: SkillEventType;
    version?: string;
    source?: string;
    targetPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await recordSkillEvent(input);
    } catch (err) {
      console.warn('[SkillsService] 技能事件记录失败:', err);
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
      this.isSshRuntimeUnavailableError(err) ||
      msg.includes('Timeout waiting for SSH connection') ||
      msg.includes('命令执行超时')
    );
  }

  private isSshRuntimeUnavailableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const lowerMsg = msg.toLowerCase();
    return (
      msg.includes(SSH_RUNTIME_UNAVAILABLE_MESSAGE) ||
      msg.includes('SSH 连接池未初始化') ||
      msg.includes('initSSHPool') ||
      (msg.includes('SSH') && msg.includes('not initialized')) ||
      (lowerMsg.includes('sandbox') && lowerMsg.includes('not found'))
    );
  }

  private toServiceUnavailableError(err: unknown): SkillsError {
    const msg = err instanceof Error ? err.message : String(err);
    if (this.isSshRuntimeUnavailableError(err)) {
      return new SkillsError(503, SSH_RUNTIME_UNAVAILABLE_MESSAGE);
    }
    if (msg.includes('Timeout waiting for SSH connection') || msg.includes('命令执行超时')) {
      return new SkillsError(503, '技能服务连接超时，请稍后重试');
    }
    return new SkillsError(503, '技能服务暂时不可用，请稍后重试');
  }
}
