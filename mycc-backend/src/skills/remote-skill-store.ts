import matter from 'gray-matter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSSHPool } from '../ssh/pool.js';
import { escapeShellArg } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import type { SkillInfo, SkillInstallMetadata } from './types.js';
import { ClawHubAdapter } from './clawhub-adapter.js';
import { SKILL_REGISTRY, getSkillById, getIconForSkill, getMarketSkills, getBuiltinSkills, getVersionForSkill, getTriggersForSkill, getAssistantSkillNameForSkill, getSkillByAssistantSkillName } from './skill-registry.js';

type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
type CatalogCacheEntry = { path: string; expiresAt: number };
type InstalledSkillEntry = {
  filePath: string;
  dirName: string;
  skillId: string;
  assistantSkillName: string;
};
export type SkillRuntimeContext = { userId?: number; linuxUser: string };
export type SkillCommandRunner = {
  linuxUser: string;
  run: ExecFn;
  runAsUser: ExecFn;
  autoSeedOnList?: boolean;
  release?: () => void | Promise<void>;
};
export type SkillCommandRunnerFactory = (context: SkillRuntimeContext) => Promise<SkillCommandRunner>;

function shouldIncludeClawHubInList(): boolean {
  const raw = process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isValidSkillId(skillId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(skillId);
}

function isValidAssistantSkillName(skillName: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(skillName);
}

function getParsedAssistantSkillName(parsedData: Record<string, unknown>): string | null {
  const rawName = parsedData.name;
  if (typeof rawName !== 'string') {
    return null;
  }
  const skillName = rawName.trim();
  return isValidAssistantSkillName(skillName) ? skillName : null;
}

function getAssistantSkillName(skillId: string, parsedData?: Record<string, unknown>): string {
  const parsedName = parsedData ? getParsedAssistantSkillName(parsedData) : null;
  return parsedName || getAssistantSkillNameForSkill(skillId) || skillId;
}

function normalizeVersion(input: unknown): { version: string; legacy: boolean } {
  if (typeof input === 'string' && /^\d+\.\d+\.\d+([-.][a-zA-Z0-9.]+)?$/.test(input.trim())) {
    return { version: input.trim(), legacy: false };
  }
  return { version: '0.0.0-legacy', legacy: true };
}

function normalizeSkillVersion(skillId: string, input: unknown): { version: string; legacy: boolean } {
  const versionMeta = normalizeVersion(input);
  if (!versionMeta.legacy) {
    return versionMeta;
  }
  const registrySkill = getSkillById(skillId);
  if (registrySkill) {
    return { version: getVersionForSkill(skillId), legacy: false };
  }
  return versionMeta;
}

function toSkillInfo(
  skillId: string,
  content: string,
  source: string,
  status: SkillInfo['status'],
  installedVersion?: string | null
): SkillInfo {
  const parsed = matter(content);
  const versionMeta = normalizeSkillVersion(skillId, parsed.data.version);
  const latestVersion = versionMeta.version;
  const currentVersion = status === 'installed' ? (installedVersion || latestVersion) : latestVersion;
  const registryEntry = getSkillById(skillId);
  const assistantSkillName = getAssistantSkillName(skillId, parsed.data);

  return {
    id: skillId,
    assistantSkillName,
    name: registryEntry?.name || (parsed.data.name as string) || skillId,
    description: registryEntry?.description || (parsed.data.description as string) || '',
    trigger: registryEntry?.trigger || `/${skillId}`,
    triggers: getTriggersForSkill(skillId, parsed.data.trigger as string | undefined, parsed.data.triggers),
    icon: getIconForSkill(skillId),
    status,
    installed: status === 'installed',
    version: currentVersion,
    installedVersion: status === 'installed' ? currentVersion : null,
    latestVersion,
    source,
    legacy: versionMeta.legacy,
    enabled: status !== 'disabled',
    upgradable: false,
    category: registryEntry?.category,
    owner: registryEntry?.owner || (typeof parsed.data.owner === 'string' ? parsed.data.owner : undefined),
  };
}

function toRegistrySkillInfo(
  skillId: string,
  status: SkillInfo['status'],
  version: string,
  source: string,
  installed: boolean,
  enabled: boolean
): SkillInfo | null {
  const registryEntry = getSkillById(skillId);
  if (!registryEntry) {
    return null;
  }
  return {
    id: skillId,
    assistantSkillName: getAssistantSkillNameForSkill(skillId),
    name: registryEntry.name,
    description: registryEntry.description,
    trigger: registryEntry.trigger,
    triggers: getTriggersForSkill(skillId),
    icon: registryEntry.icon,
    status,
    installed,
    version,
    installedVersion: installed ? version : null,
    latestVersion: version,
    source,
    legacy: false,
    enabled,
    upgradable: false,
    category: registryEntry.category,
    owner: registryEntry.owner,
  };
}

function skillsManifestPath(linuxUser: string): string {
  return `/home/${linuxUser}/.claude/skills/.mycc-manifest.json`;
}

function skillsLockPath(linuxUser: string): string {
  return `/home/${linuxUser}/.claude/skills/.mycc-lock.json`;
}

function userSkillsDir(linuxUser: string): string {
  return `/home/${linuxUser}/.claude/skills`;
}

function userCatalogSeedDir(linuxUser: string): string {
  return `/home/${linuxUser}/.claude/skills-catalog`;
}

function runAsLinuxUserCommand(linuxUser: string, command: string): string {
  return `sudo -u ${escapeShellArg(linuxUser)} bash -lc ${escapeShellArg(command)}`;
}

const runtimeCatalogDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog');

async function createSshSkillCommandRunner(context: SkillRuntimeContext): Promise<SkillCommandRunner> {
  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();
  const run: ExecFn = (command) => sshPool.exec(connection, command);
  const runAsUser: ExecFn = (command) =>
    sshPool.exec(connection, runAsLinuxUserCommand(context.linuxUser, command));

  return {
    linuxUser: context.linuxUser,
    run,
    runAsUser,
    release: () => sshPool.release(connection),
  };
}

function extractSkillIdFromPath(skillMdPath: string): string | null {
  const parts = skillMdPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] ?? null;
}

export class RemoteSkillStore {
  private static catalogCache = new Map<string, CatalogCacheEntry>();
  private clawhubAdapter = new ClawHubAdapter();

  constructor(private readonly runnerFactory: SkillCommandRunnerFactory = createSshSkillCommandRunner) {}

  async ensureBuiltinSkills(context: string | SkillRuntimeContext): Promise<number> {
    return this.withRunner(context, async ({ run, runAsUser, linuxUser }) => {
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      return this.seedBuiltinSkills(run, runAsUser, linuxUser, catalogDir);
    });
  }

  async listSkillInfos(context: string | SkillRuntimeContext): Promise<{ skills: SkillInfo[]; catalogAvailable: boolean }> {
    return this.withRunner(context, async (runner) => {
      const { run, runAsUser, linuxUser } = runner;
      const installedDir = userSkillsDir(linuxUser);
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      let manifest = await this.readManifest(runAsUser, linuxUser);

      const installedResult = await runAsUser(
        `find ${escapeShellArg(installedDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
      );
      const availableResult = catalogDir
        ? await run(
            `find ${escapeShellArg(catalogDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
          )
        : { stdout: '', stderr: '', exitCode: 0 };

      let installedPaths = installedResult.stdout.trim().split('\n').filter(Boolean);
      const availablePaths = availableResult.stdout.trim().split('\n').filter(Boolean);
      const map = new Map<string, SkillInfo>();

      // 首次访问（无 manifest 且无已安装技能）时，自动补齐内置技能。
      // 同时兼容老账号：若检测到缺失内置技能，也执行一次补齐。
      let installedEntries = await this.resolveInstalledSkillEntries(runAsUser, installedPaths);
      let installedIds = new Set(installedEntries.map((entry) => entry.skillId));
      const availablePathById = new Map<string, string>();
      for (const filePath of availablePaths) {
        const dirName = extractSkillIdFromPath(filePath);
        const skillId = dirName ? this.resolveRegistrySkillIdFromDirName(dirName) : null;
        if (!skillId || !isValidSkillId(skillId) || availablePathById.has(skillId)) {
          continue;
        }
        availablePathById.set(skillId, filePath);
      }
      const hasMissingBuiltin = getBuiltinSkills().some((skill) => !installedIds.has(skill.id));
      const shouldAutoSeedOnList = runner.autoSeedOnList !== false;

      if (shouldAutoSeedOnList && ((!manifest && installedPaths.length === 0) || (installedPaths.length > 0 && hasMissingBuiltin))) {
        const seeded = await this.seedBuiltinSkills(run, runAsUser, linuxUser, catalogDir);
        if (seeded > 0) {
          const refreshedInstalled = await runAsUser(
            `find ${escapeShellArg(installedDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
          );
          installedPaths = refreshedInstalled.stdout.trim().split('\n').filter(Boolean);
          installedEntries = await this.resolveInstalledSkillEntries(runAsUser, installedPaths);
          installedIds = new Set(installedEntries.map((entry) => entry.skillId));
          manifest = await this.readManifest(runAsUser, linuxUser);
        }
      }

      for (const [skillId, filePath] of availablePathById) {
        const registrySkill = getSkillById(skillId);
        const shouldParseSkillFile = installedIds.has(skillId) || !registrySkill;

        if (shouldParseSkillFile) {
          const skill = await this.readSkillInfo(run, filePath, 'catalog', 'available', skillId);
          if (skill) {
            map.set(skill.id, skill);
          }
          continue;
        }

        const fromRegistry = toRegistrySkillInfo(skillId, 'available', getVersionForSkill(skillId), 'catalog', false, false);
        if (fromRegistry) {
          map.set(skillId, fromRegistry);
        }
      }

      for (const installedEntry of installedEntries) {
        const { filePath, skillId, assistantSkillName } = installedEntry;
        if (!skillId || !isValidSkillId(skillId)) {
          continue;
        }

        const manifestEntry = manifest?.skills?.[skillId];
        const disabled = Boolean(manifest?.skills?.[skillId]?.disabled);
        const status: SkillInfo['status'] = disabled ? 'disabled' : 'installed';
        const existed = map.get(skillId);
        const manifestVersion = typeof manifestEntry?.version === 'string'
          ? normalizeVersion(manifestEntry.version).version
          : null;
        let installedVersion =
          manifestVersion ||
          existed?.installedVersion ||
          existed?.version ||
          existed?.latestVersion ||
          null;

        if (existed && installedVersion) {
          const latestVersion = existed.latestVersion || installedVersion;
          map.set(skillId, {
            ...existed,
            assistantSkillName,
            status,
            installed: true,
            installedVersion,
            version: installedVersion,
            enabled: !disabled,
            upgradable: installedVersion !== latestVersion,
            legacy: existed.legacy,
          });
          continue;
        }

        const fromRegistry = toRegistrySkillInfo(
          skillId,
          status,
          installedVersion || getVersionForSkill(skillId),
          manifestEntry?.source || 'user',
          true,
          !disabled
        );
        if (fromRegistry && installedVersion) {
          map.set(skillId, fromRegistry);
          continue;
        }

        const parsedInstalled = await this.readSkillInfo(runAsUser, filePath, 'user', 'installed', skillId);
        if (!parsedInstalled) {
          continue;
        }
        installedVersion = parsedInstalled.version;
        parsedInstalled.status = status;
        parsedInstalled.installed = true;
        parsedInstalled.installedVersion = installedVersion;
        parsedInstalled.version = installedVersion;
        parsedInstalled.enabled = !disabled;
        parsedInstalled.upgradable = false;
        map.set(skillId, parsedInstalled);
      }

      // 可选合并 ClawHub 技能（默认关闭，避免拖慢技能列表首屏）
      if (shouldIncludeClawHubInList()) {
        try {
          const clawhubSkills = await this.clawhubAdapter.listAvailableSkills(linuxUser);
          for (const skill of clawhubSkills) {
            if (!map.has(skill.id)) {
              map.set(skill.id, skill);
            }
          }
        } catch (error) {
          console.warn('[RemoteSkillStore] ClawHub 技能加载失败:', error);
          // 不阻断主流程，继续返回其他技能
        }
      }

      // 合并 registry 中的市场技能
      for (const def of getMarketSkills()) {
        if (!map.has(def.id)) {
          map.set(def.id, {
            id: def.id,
            assistantSkillName: getAssistantSkillNameForSkill(def.id),
            name: def.name,
            description: def.description,
            trigger: def.trigger,
            triggers: getTriggersForSkill(def.id),
            icon: def.icon,
            status: 'available',
            installed: false,
            version: getVersionForSkill(def.id),
            installedVersion: null,
            latestVersion: getVersionForSkill(def.id),
            source: 'catalog',
            legacy: false,
            enabled: false,
            upgradable: false,
          });
        }
      }

      const skills = Array.from(map.values()).sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      return {
        skills,
        catalogAvailable: Boolean(catalogDir),
      };
    });
  }

  async searchSkills(linuxUser: string, query: string): Promise<SkillInfo[]> {
    if (!query || query.trim().length < 2) {
      throw new SkillsError(400, '搜索关键词至少需要 2 个字符');
    }

    const q = query.toLowerCase();

    // 先搜 registry
    const registryResults: SkillInfo[] = SKILL_REGISTRY
      .filter(s => s.readiness === 'L1')
      .filter(s =>
        s.id.includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        getTriggersForSkill(s.id).some((trigger) => trigger.toLowerCase().includes(q))
      )
      .map(def => ({
        id: def.id,
        assistantSkillName: getAssistantSkillNameForSkill(def.id),
        name: def.name,
        description: def.description,
        trigger: def.trigger,
        triggers: getTriggersForSkill(def.id),
        icon: def.icon,
        status: 'available' as const,
        installed: false,
        version: getVersionForSkill(def.id),
        installedVersion: null,
        latestVersion: getVersionForSkill(def.id),
        source: 'catalog',
        legacy: false,
        enabled: false,
        upgradable: false,
        category: def.category,
        owner: def.owner,
      }));

    return registryResults;
  }

  async installSkill(context: string | SkillRuntimeContext, skillId: string): Promise<SkillInstallMetadata> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    return this.withRunner(context, async ({ run, runAsUser, linuxUser }) => {
      const sourceDir = await this.resolveSkillSourceDir(run, runAsUser, linuxUser, skillId);
      if (!sourceDir) {
        throw new SkillsError(404, '技能不存在于目录中');
      }
      const assistantSkillName = await this.resolveAssistantSkillNameFromSource(run, runAsUser, sourceDir, skillId);
      const { targetDir, legacyTargetDir } = this.buildInstallTargetPaths(linuxUser, skillId, assistantSkillName);

      await runAsUser(`mkdir -p ${escapeShellArg(userSkillsDir(linuxUser))}`);
      await this.migrateLegacyInstallDir(runAsUser, legacyTargetDir, targetDir);
      const copy = await runAsUser(
        `[ -d ${escapeShellArg(targetDir)} ] || cp -a ${escapeShellArg(sourceDir)} ${escapeShellArg(targetDir)}`
      );
      if (copy.exitCode !== 0) {
        throw new SkillsError(500, copy.stderr || '安装技能失败');
      }

      const skillFile = `${targetDir}/SKILL.md`;
      const catSkill = await runAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);
      const parsed = matter(catSkill.stdout || '');
      const version = normalizeSkillVersion(skillId, parsed.data.version).version;

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId,
        version,
        source: 'catalog',
        installedPath: targetDir,
        disabled: false,
      });

      return { version, source: 'catalog', targetPath: targetDir };
    });
  }

  async upgradeSkill(context: string | SkillRuntimeContext, skillId: string): Promise<SkillInstallMetadata> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    return this.withRunner(context, async ({ run, runAsUser, linuxUser }) => {
      const sourceDir = await this.resolveSkillSourceDir(run, runAsUser, linuxUser, skillId);
      if (!sourceDir) {
        throw new SkillsError(404, '技能不存在于目录中');
      }
      const assistantSkillName = await this.resolveAssistantSkillNameFromSource(run, runAsUser, sourceDir, skillId);
      const { targetDir, legacyTargetDir } = this.buildInstallTargetPaths(linuxUser, skillId, assistantSkillName);
      await this.migrateLegacyInstallDir(runAsUser, legacyTargetDir, targetDir);

      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);
      if (!targetCheck.stdout.trim()) {
        throw new SkillsError(404, '技能未安装，无法升级');
      }

      const manifest = await this.readManifest(runAsUser, linuxUser);

      if (sourceDir === targetDir) {
        const currentSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
        const parsedCurrent = matter(currentSkill.stdout || '');
        return {
          version: normalizeSkillVersion(skillId, parsedCurrent.data.version).version,
          source: 'catalog',
          targetPath: targetDir,
        };
      }

      const cleanupLegacy = legacyTargetDir === targetDir
        ? ''
        : ` && rm -rf ${escapeShellArg(legacyTargetDir)}`;
      const upgrade = await runAsUser(
        `rm -rf ${escapeShellArg(targetDir)} && cp -a ${escapeShellArg(sourceDir)} ${escapeShellArg(targetDir)}${cleanupLegacy}`
      );
      if (upgrade.exitCode !== 0) {
        throw new SkillsError(500, upgrade.stderr || '升级技能失败');
      }

      const catSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
      const parsed = matter(catSkill.stdout || '');
      const version = normalizeSkillVersion(skillId, parsed.data.version).version;
      const disabled = Boolean(manifest?.skills?.[skillId]?.disabled);

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId,
        version,
        source: 'catalog',
        installedPath: targetDir,
        disabled,
      });

      return { version, source: 'catalog', targetPath: targetDir };
    });
  }

  async setSkillEnabled(context: string | SkillRuntimeContext, skillId: string, enabled: boolean): Promise<void> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }
    await this.withRunner(context, async ({ runAsUser, linuxUser }) => {
      const { targetDir, legacyTargetDir } = this.buildInstallTargetPaths(linuxUser, skillId);
      await this.migrateLegacyInstallDir(runAsUser, legacyTargetDir, targetDir);
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);
      if (!targetCheck.stdout.trim()) {
        throw new SkillsError(404, '技能未安装');
      }

      const manifest = await this.readManifest(runAsUser, linuxUser);
      const installed = manifest?.skills?.[skillId];
      if (!installed) {
        await this.updateManifestAndLock(runAsUser, linuxUser, {
          skillId,
          version: '0.0.0-legacy',
          source: 'user',
          installedPath: targetDir,
          disabled: !enabled,
        });
        return;
      }

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId,
        version: installed.version || '0.0.0-legacy',
        source: installed.source || 'user',
        installedPath: targetDir,
        disabled: !enabled,
      });
    });
  }

  async uninstallSkill(context: string | SkillRuntimeContext, skillId: string): Promise<void> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    await this.withRunner(context, async ({ runAsUser, linuxUser }) => {
      const { targetDir, legacyTargetDir } = this.buildInstallTargetPaths(linuxUser, skillId);

      // Delete both canonical and legacy id directories for backward compatibility.
      await runAsUser(`rm -rf ${escapeShellArg(targetDir)} ${escapeShellArg(legacyTargetDir)}`);

      // Remove from manifest and lock
      await this.removeFromManifestAndLock(runAsUser, linuxUser, skillId);
    });
  }

  private async withRunner<T>(
    context: string | SkillRuntimeContext,
    operation: (runner: SkillCommandRunner) => Promise<T>
  ): Promise<T> {
    const runner = await this.runnerFactory(this.normalizeRuntimeContext(context));
    try {
      return await operation(runner);
    } finally {
      await runner.release?.();
    }
  }

  private normalizeRuntimeContext(context: string | SkillRuntimeContext): SkillRuntimeContext {
    return typeof context === 'string' ? { linuxUser: context } : context;
  }

  private async seedBuiltinSkills(
    run: ExecFn,
    runAsUser: ExecFn,
    linuxUser: string,
    catalogDir: string | null
  ): Promise<number> {
    const sourceRoot = catalogDir ?? await this.resolveCatalogDir(run, runAsUser, linuxUser);
    if (!sourceRoot) return 0;

    const builtinSkills = getBuiltinSkills();
    if (builtinSkills.length === 0) return 0;

    const userDir = userSkillsDir(linuxUser);
    await runAsUser(`mkdir -p ${escapeShellArg(userDir)}`);

    let seededCount = 0;
    for (const skill of builtinSkills) {
      const sourceDir = `${sourceRoot}/${skill.id}`;
      const assistantSkillName = getAssistantSkillNameForSkill(skill.id);
      const { targetDir, legacyTargetDir } = this.buildInstallTargetPaths(linuxUser, skill.id, assistantSkillName);

      const sourceCheck = await runAsUser(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
        continue;
      }

      await this.migrateLegacyInstallDir(runAsUser, legacyTargetDir, targetDir);
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);
      if (!targetCheck.stdout.trim()) {
        const copy = await runAsUser(`cp -a ${escapeShellArg(sourceDir)} ${escapeShellArg(targetDir)}`);
        if (copy.exitCode !== 0) {
          throw new SkillsError(500, copy.stderr || `自动安装内置技能失败: ${skill.id}`);
        }
      }

      const skillFile = `${targetDir}/SKILL.md`;
      const skillResult = await runAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);
      const parsed = matter(skillResult.stdout || '');
      const version = normalizeSkillVersion(skill.id, parsed.data.version).version;

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId: skill.id,
        version,
        source: 'catalog',
        installedPath: targetDir,
        disabled: false,
      });
      seededCount += 1;
    }

    return seededCount;
  }

  private async readSkillInfo(
    exec: ExecFn,
    skillFilePath: string,
    source: string,
    status: SkillInfo['status'],
    skillIdOverride?: string
  ): Promise<SkillInfo | null> {
    try {
      const catResult = await exec(`cat ${escapeShellArg(skillFilePath)}`);
      if (catResult.exitCode !== 0) return null;
      const skillId = skillIdOverride || skillFilePath.split('/').slice(-2, -1)[0];
      if (!isValidSkillId(skillId)) return null;
      return toSkillInfo(skillId, catResult.stdout, source, status);
    } catch {
      return null;
    }
  }

  private async resolveInstalledSkillEntries(exec: ExecFn, skillFilePaths: string[]): Promise<InstalledSkillEntry[]> {
    const entries: InstalledSkillEntry[] = [];
    for (const filePath of skillFilePaths) {
      const dirName = extractSkillIdFromPath(filePath);
      if (!dirName || !isValidAssistantSkillName(dirName)) {
        continue;
      }

      const registrySkill = getSkillById(dirName) || getSkillByAssistantSkillName(dirName);
      if (registrySkill) {
        entries.push({
          filePath,
          dirName,
          skillId: registrySkill.id,
          assistantSkillName: getAssistantSkillNameForSkill(registrySkill.id),
        });
        continue;
      }

      const catResult = await exec(`cat ${escapeShellArg(filePath)} 2>/dev/null || true`);
      const parsed = matter(catResult.stdout || '');
      const assistantSkillName = getAssistantSkillName(dirName, parsed.data);
      const matchedRegistrySkill = getSkillByAssistantSkillName(assistantSkillName);
      entries.push({
        filePath,
        dirName,
        skillId: matchedRegistrySkill?.id || dirName,
        assistantSkillName,
      });
    }
    return entries;
  }

  private resolveRegistrySkillIdFromDirName(dirName: string): string | null {
    if (!isValidAssistantSkillName(dirName)) {
      return null;
    }
    return getSkillById(dirName)?.id || getSkillByAssistantSkillName(dirName)?.id || dirName;
  }

  private async resolveAssistantSkillNameFromSource(
    exec: ExecFn,
    execAsUser: ExecFn,
    sourceDir: string,
    skillId: string
  ): Promise<string> {
    const skillFile = `${sourceDir}/SKILL.md`;
    let catResult = await exec(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);
    if (!catResult.stdout.trim()) {
      catResult = await execAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);
    }
    const parsed = matter(catResult.stdout || '');
    return getAssistantSkillName(skillId, parsed.data);
  }

  private buildInstallTargetPaths(
    linuxUser: string,
    skillId: string,
    assistantSkillName = getAssistantSkillNameForSkill(skillId)
  ): { targetDir: string; legacyTargetDir: string } {
    const userDir = userSkillsDir(linuxUser);
    return {
      targetDir: `${userDir}/${assistantSkillName}`,
      legacyTargetDir: `${userDir}/${skillId}`,
    };
  }

  private async migrateLegacyInstallDir(exec: ExecFn, legacyTargetDir: string, targetDir: string): Promise<void> {
    if (legacyTargetDir === targetDir) {
      return;
    }
    const migrate = await exec(
      `[ -d ${escapeShellArg(legacyTargetDir)} ] && [ ! -d ${escapeShellArg(targetDir)} ] && mv ${escapeShellArg(legacyTargetDir)} ${escapeShellArg(targetDir)} || true`
    );
    if (migrate.exitCode !== 0) {
      throw new SkillsError(500, migrate.stderr || '迁移旧技能目录失败');
    }
  }

  private async resolveCatalogDir(exec: ExecFn, execAsUser: ExecFn, linuxUser: string): Promise<string | null> {
    const cached = RemoteSkillStore.catalogCache.get(linuxUser);
    if (cached && cached.expiresAt > Date.now()) {
      const check = await exec(
        `[ -d ${escapeShellArg(cached.path)} ] && echo ok || true`
      );
      if (check.stdout.trim()) {
        return cached.path;
      }
      RemoteSkillStore.catalogCache.delete(linuxUser);
    }

    const candidates = this.buildCatalogCandidates(linuxUser);
    if (candidates.length > 0) {
      const batchCheckScript = candidates
        .map((candidate) => `[ -d ${escapeShellArg(candidate)} ] && echo ${escapeShellArg(candidate)} && exit 0`)
        .join('\n');
      const batchCheck = await exec(`${batchCheckScript}\ntrue`);
      const matched = batchCheck.stdout.trim().split('\n').filter(Boolean)[0];
      if (matched) {
        this.cacheCatalogPath(linuxUser, matched);
        return matched;
      }
    }

    const userCatalog = userCatalogSeedDir(linuxUser);
    const userCatalogCheck = await execAsUser(
      `[ -d ${escapeShellArg(userCatalog)} ] && echo ${escapeShellArg(userCatalog)} || true`
    );
    if (userCatalogCheck.stdout.trim()) {
      this.cacheCatalogPath(linuxUser, userCatalog);
      return userCatalog;
    }

    const bootstrapped = await this.bootstrapCatalog(execAsUser, linuxUser);
    if (bootstrapped) {
      this.cacheCatalogPath(linuxUser, bootstrapped);
    }
    return bootstrapped;
  }

  private buildCatalogCandidates(linuxUser: string): string[] {
    const explicit = process.env.SKILLS_CATALOG_DIR?.trim();
    const ordered = [
      explicit || '',
      runtimeCatalogDir,
      '/opt/mycc/.claude/skills',
      '/opt/mycc/mycc/.claude/skills',
      '/opt/mycc/skills',
      '/home/mycc/.claude/skills',
      userCatalogSeedDir(linuxUser),
    ].filter(Boolean);
    return Array.from(new Set(ordered));
  }

  private async resolveSkillSourceDir(
    exec: ExecFn,
    execAsUser: ExecFn,
    linuxUser: string,
    skillId: string
  ): Promise<string | null> {
    const primary = await this.resolveCatalogDir(exec, execAsUser, linuxUser);
    const candidates = Array.from(
      new Set([primary || '', ...this.buildCatalogCandidates(linuxUser)].filter(Boolean))
    );

    for (const candidate of candidates) {
      const sourceDir = `${candidate}/${skillId}`;
      const check = await exec(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (check.stdout.trim()) {
        return sourceDir;
      }
    }

    return null;
  }

  private cacheCatalogPath(linuxUser: string, path: string): void {
    RemoteSkillStore.catalogCache.set(linuxUser, {
      path,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }

  private async bootstrapCatalog(exec: ExecFn, linuxUser: string): Promise<string | null> {
    const catalogDir = userCatalogSeedDir(linuxUser);
    const seedFrom = userSkillsDir(linuxUser);
    const builtinSkills = getBuiltinSkills();
    const mkdirList = builtinSkills.map(s => `"$CATALOG/${s.id}"`).join(' ');

    const skillFiles = builtinSkills.map(s => {
      const escaped = s.description.replace(/'/g, "'\\''");
      return `cat > "$CATALOG/${s.id}/SKILL.md" <<'SKILL'
---
name: ${s.name}
description: ${s.description}
version: 1.0.0
source: mycc-builtin
triggers:
  - ${s.trigger}
---

${s.description}
SKILL`;
    }).join('\n');

    const command = `
set -e
CATALOG=${escapeShellArg(catalogDir)}
SEED=${escapeShellArg(seedFrom)}
mkdir -p "$CATALOG"
if [ "$(ls -A "$CATALOG" 2>/dev/null || true)" != "" ]; then
  echo "$CATALOG"
  exit 0
fi
if [ -d "$SEED" ] && [ "$(find "$SEED" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -gt 0 ]; then
  cp -a "$SEED/." "$CATALOG"/
  echo "$CATALOG"
  exit 0
fi
mkdir -p ${mkdirList}
${skillFiles}
echo "$CATALOG"
exit 0
`;
    const result = await exec(command);
    const out = result.stdout.trim();
    return out ? out.split('\n').pop() || null : null;
  }

  private async updateManifestAndLock(
    exec: ExecFn,
    linuxUser: string,
    payload: { skillId: string; version: string; source: string; installedPath: string; disabled: boolean }
  ): Promise<void> {
    const manifest = skillsManifestPath(linuxUser);
    const lock = skillsLockPath(linuxUser);
    const now = new Date().toISOString();

    const script = `
MANIFEST=${escapeShellArg(manifest)}
LOCK=${escapeShellArg(lock)}
SKILL_ID=${escapeShellArg(payload.skillId)}
VERSION=${escapeShellArg(payload.version)}
SOURCE=${escapeShellArg(payload.source)}
INSTALLED_PATH=${escapeShellArg(payload.installedPath)}
DISABLED=${escapeShellArg(String(payload.disabled))}
NOW=${escapeShellArg(now)}
export MANIFEST LOCK SKILL_ID VERSION SOURCE INSTALLED_PATH DISABLED NOW

mkdir -p "$(dirname "$MANIFEST")"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const manifestPath = process.env.MANIFEST;
const lockPath = process.env.LOCK;
const id = process.env.SKILL_ID;
const version = process.env.VERSION;
const source = process.env.SOURCE;
const installedPath = process.env.INSTALLED_PATH;
const disabled = process.env.DISABLED === 'true';
const now = process.env.NOW;

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

const manifest = readJson(manifestPath, { version: 1, updatedAt: now, skills: {} });
manifest.version = 1;
manifest.updatedAt = now;
manifest.skills = manifest.skills || {};
manifest.skills[id] = {
  version,
  source,
  installedAt: manifest.skills[id]?.installedAt || now,
  updatedAt: now,
  pinned: Boolean(manifest.skills[id]?.pinned),
  disabled,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const lock = readJson(lockPath, { version: 1, generatedAt: now, skills: {} });
lock.version = 1;
lock.generatedAt = now;
lock.skills = lock.skills || {};
lock.skills[id] = {
  version,
  source,
  installedPath,
  disabled,
};
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
NODE
`;

    const result = await exec(script);
    if (result.exitCode !== 0) {
      throw new SkillsError(500, result.stderr || '写入技能状态文件失败');
    }
  }

  private async readManifest(
    exec: ExecFn,
    linuxUser: string
  ): Promise<{ skills?: Record<string, { version?: string; source?: string; disabled?: boolean }> } | null> {
    const manifestPath = skillsManifestPath(linuxUser);
    const result = await exec(`cat ${escapeShellArg(manifestPath)} 2>/dev/null || true`);
    if (!result.stdout.trim()) {
      return null;
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  }

  private async removeFromManifestAndLock(
    exec: ExecFn,
    linuxUser: string,
    skillId: string
  ): Promise<void> {
    const manifest = skillsManifestPath(linuxUser);
    const lock = skillsLockPath(linuxUser);

    const script = `
MANIFEST=${escapeShellArg(manifest)}
LOCK=${escapeShellArg(lock)}
SKILL_ID=${escapeShellArg(skillId)}
export MANIFEST LOCK SKILL_ID

node <<'NODE'
const fs = require('fs');
const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

const manifestPath = process.env.MANIFEST;
const lockPath = process.env.LOCK;
const id = process.env.SKILL_ID;

const manifest = readJson(manifestPath, { version: 1, skills: {} });
if (manifest.skills && manifest.skills[id]) {
  delete manifest.skills[id];
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const lock = readJson(lockPath, { version: 1, skills: {} });
if (lock.skills && lock.skills[id]) {
  delete lock.skills[id];
  lock.generatedAt = new Date().toISOString();
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
}
NODE
`;

    const result = await exec(script);
    if (result.exitCode !== 0) {
      throw new SkillsError(500, result.stderr || '清理技能状态文件失败');
    }
  }
}
