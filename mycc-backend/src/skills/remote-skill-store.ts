import matter from 'gray-matter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSSHPool } from '../ssh/pool.js';
import { escapeShellArg } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import type { SkillInfo } from './types.js';
import { ClawHubAdapter } from './clawhub-adapter.js';
import { SKILL_REGISTRY, getSkillById, getIconForSkill, getMarketSkills, getBuiltinSkills } from './skill-registry.js';

type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
type CatalogCacheEntry = { path: string; expiresAt: number };

function shouldIncludeClawHubInList(): boolean {
  const raw = process.env.SKILLS_INCLUDE_CLAWHUB_IN_LIST?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isValidSkillId(skillId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(skillId);
}

function normalizeVersion(input: unknown): { version: string; legacy: boolean } {
  if (typeof input === 'string' && /^\d+\.\d+\.\d+([-.][a-zA-Z0-9.]+)?$/.test(input.trim())) {
    return { version: input.trim(), legacy: false };
  }
  return { version: '0.0.0-legacy', legacy: true };
}

function toSkillInfo(
  skillId: string,
  content: string,
  source: string,
  status: SkillInfo['status'],
  installedVersion?: string | null
): SkillInfo {
  const parsed = matter(content);
  const versionMeta = normalizeVersion(parsed.data.version);
  const latestVersion = versionMeta.version;
  const currentVersion = status === 'installed' ? (installedVersion || latestVersion) : latestVersion;
  const registryEntry = getSkillById(skillId);

  return {
    id: skillId,
    name: registryEntry?.name || (parsed.data.name as string) || skillId,
    description: registryEntry?.description || (parsed.data.description as string) || '',
    trigger: registryEntry?.trigger || `/${skillId}`,
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
    name: registryEntry.name,
    description: registryEntry.description,
    trigger: registryEntry.trigger,
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
  };
}

function skillsManifestPath(linuxUser: string): string {
  return `/home/${linuxUser}/workspace/.claude/skills/.mycc-manifest.json`;
}

function skillsLockPath(linuxUser: string): string {
  return `/home/${linuxUser}/workspace/.claude/skills/.mycc-lock.json`;
}

function userSkillsDir(linuxUser: string): string {
  return `/home/${linuxUser}/workspace/.claude/skills`;
}

function userCatalogSeedDir(linuxUser: string): string {
  return `/home/${linuxUser}/workspace/.claude/skills-catalog`;
}

function runAsLinuxUserCommand(linuxUser: string, command: string): string {
  return `sudo -u ${escapeShellArg(linuxUser)} bash -lc ${escapeShellArg(command)}`;
}

const runtimeCatalogDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog');

function extractSkillIdFromPath(skillMdPath: string): string | null {
  const parts = skillMdPath.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] ?? null;
}

export class RemoteSkillStore {
  private static catalogCache = new Map<string, CatalogCacheEntry>();
  private clawhubAdapter = new ClawHubAdapter();

  async ensureBuiltinSkills(linuxUser: string): Promise<number> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      return this.seedBuiltinSkills(run, runAsUser, linuxUser, catalogDir);
    } finally {
      sshPool.release(connection);
    }
  }

  async listSkillInfos(linuxUser: string): Promise<{ skills: SkillInfo[]; catalogAvailable: boolean }> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));
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
      const installedIds = new Set(
        installedPaths
          .map((p) => extractSkillIdFromPath(p))
          .filter((id): id is string => Boolean(id))
      );
      const availablePathById = new Map<string, string>();
      for (const filePath of availablePaths) {
        const skillId = extractSkillIdFromPath(filePath);
        if (!skillId || !isValidSkillId(skillId) || availablePathById.has(skillId)) {
          continue;
        }
        availablePathById.set(skillId, filePath);
      }
      const hasMissingBuiltin = getBuiltinSkills().some((skill) => !installedIds.has(skill.id));

      if ((!manifest && installedPaths.length === 0) || (installedPaths.length > 0 && hasMissingBuiltin)) {
        const seeded = await this.seedBuiltinSkills(run, runAsUser, linuxUser, catalogDir);
        if (seeded > 0) {
          const refreshedInstalled = await runAsUser(
            `find ${escapeShellArg(installedDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
          );
          installedPaths = refreshedInstalled.stdout.trim().split('\n').filter(Boolean);
          manifest = await this.readManifest(runAsUser, linuxUser);
        }
      }

      for (const [skillId, filePath] of availablePathById) {
        const registrySkill = getSkillById(skillId);
        const shouldParseSkillFile = installedIds.has(skillId) || !registrySkill;

        if (shouldParseSkillFile) {
          const skill = await this.readSkillInfo(run, filePath, 'catalog', 'available');
          if (skill) {
            map.set(skill.id, skill);
          }
          continue;
        }

        const fromRegistry = toRegistrySkillInfo(skillId, 'available', '1.0.0', 'catalog', false, false);
        if (fromRegistry) {
          map.set(skillId, fromRegistry);
        }
      }

      for (const path of installedPaths) {
        const skillId = extractSkillIdFromPath(path);
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
          installedVersion || '0.0.0-legacy',
          manifestEntry?.source || 'user',
          true,
          !disabled
        );
        if (fromRegistry && installedVersion) {
          map.set(skillId, fromRegistry);
          continue;
        }

        const parsedInstalled = await this.readSkillInfo(runAsUser, path, 'user', 'installed');
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
            name: def.name,
            description: def.description,
            trigger: def.trigger,
            icon: def.icon,
            status: 'available',
            installed: false,
            version: '1.0.0',
            installedVersion: null,
            latestVersion: '1.0.0',
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
    } finally {
      sshPool.release(connection);
    }
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
        s.trigger.includes(q)
      )
      .map(def => ({
        id: def.id,
        name: def.name,
        description: def.description,
        trigger: def.trigger,
        icon: def.icon,
        status: 'available' as const,
        installed: false,
        version: '1.0.0',
        installedVersion: null,
        latestVersion: '1.0.0',
        source: 'catalog',
        legacy: false,
        enabled: false,
        upgradable: false,
      }));

    if (registryResults.length > 0) {
      return registryResults;
    }

    // fallback: 搜 ClawHub
    try {
      return await this.clawhubAdapter.searchSkills(linuxUser, query);
    } catch (error) {
      console.error('[RemoteSkillStore] 搜索失败:', error);
      throw new SkillsError(500, '搜索技能失败');
    }
  }

  async installSkill(linuxUser: string, skillId: string): Promise<string> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      // 先检查是否是 ClawHub 技能
      const targetDir = `${userSkillsDir(linuxUser)}/${skillId}`;
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);

      if (!targetCheck.stdout.trim()) {
        // 技能未安装，尝试从 ClawHub 安装
        try {
          const version = await this.clawhubAdapter.installSkill(linuxUser, skillId);

          // 更新 manifest 和 lock
          await this.updateManifestAndLock(runAsUser, linuxUser, {
            skillId,
            version,
            source: 'clawhub',
            installedPath: targetDir,
            disabled: false,
          });

          return version;
        } catch (clawhubError) {
          console.warn(`[RemoteSkillStore] ClawHub 安装失败，尝试本地 catalog:`, clawhubError);
          // 回退到本地 catalog 安装
        }
      }

      // 本地 catalog 安装逻辑（原有逻辑）
      const sourceDir = await this.resolveSkillSourceDir(run, runAsUser, linuxUser, skillId);
      if (!sourceDir) {
        throw new SkillsError(404, '技能不存在于目录中');
      }

      await runAsUser(`mkdir -p ${escapeShellArg(userSkillsDir(linuxUser))}`);
      const copy = await runAsUser(
        `[ -d ${escapeShellArg(targetDir)} ] || cp -a ${escapeShellArg(sourceDir)} ${escapeShellArg(targetDir)}`
      );
      if (copy.exitCode !== 0) {
        throw new SkillsError(500, copy.stderr || '安装技能失败');
      }

      const skillFile = `${targetDir}/SKILL.md`;
      const catSkill = await runAsUser(`cat ${escapeShellArg(skillFile)} 2>/dev/null || true`);
      const parsed = matter(catSkill.stdout || '');
      const version = normalizeVersion(parsed.data.version).version;

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId,
        version,
        source: 'catalog',
        installedPath: targetDir,
        disabled: false,
      });

      return version;
    } finally {
      sshPool.release(connection);
    }
  }

  async upgradeSkill(linuxUser: string, skillId: string): Promise<string> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();
    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      const targetDir = `${userSkillsDir(linuxUser)}/${skillId}`;
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);

      if (!targetCheck.stdout.trim()) {
        throw new SkillsError(404, '技能未安装，无法升级');
      }

      // 读取当前技能的 source
      const manifest = await this.readManifest(runAsUser, linuxUser);
      const currentSource = manifest?.skills?.[skillId]?.source;

      // 如果是 ClawHub 技能，使用 ClawHub 升级
      if (currentSource === 'clawhub') {
        try {
          const version = await this.clawhubAdapter.upgradeSkill(linuxUser, skillId);
          const disabled = Boolean(manifest?.skills?.[skillId]?.disabled);

          await this.updateManifestAndLock(runAsUser, linuxUser, {
            skillId,
            version,
            source: 'clawhub',
            installedPath: targetDir,
            disabled,
          });

          return version;
        } catch (clawhubError) {
          console.warn(`[RemoteSkillStore] ClawHub 升级失败:`, clawhubError);
          throw new SkillsError(500, `升级失败: ${clawhubError instanceof Error ? clawhubError.message : String(clawhubError)}`);
        }
      }

      // 本地 catalog 升级逻辑（原有逻辑）
      const sourceDir = await this.resolveSkillSourceDir(run, runAsUser, linuxUser, skillId);
      if (!sourceDir) {
        throw new SkillsError(404, '技能不存在于目录中');
      }

      if (sourceDir === targetDir) {
        const currentSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
        const parsedCurrent = matter(currentSkill.stdout || '');
        return normalizeVersion(parsedCurrent.data.version).version;
      }

      const upgrade = await runAsUser(
        `rm -rf ${escapeShellArg(targetDir)} && cp -a ${escapeShellArg(sourceDir)} ${escapeShellArg(targetDir)}`
      );
      if (upgrade.exitCode !== 0) {
        throw new SkillsError(500, upgrade.stderr || '升级技能失败');
      }

      const catSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
      const parsed = matter(catSkill.stdout || '');
      const version = normalizeVersion(parsed.data.version).version;
      const disabled = Boolean(manifest?.skills?.[skillId]?.disabled);

      await this.updateManifestAndLock(runAsUser, linuxUser, {
        skillId,
        version,
        source: 'catalog',
        installedPath: targetDir,
        disabled,
      });

      return version;
    } finally {
      sshPool.release(connection);
    }
  }

  async setSkillEnabled(linuxUser: string, skillId: string, enabled: boolean): Promise<void> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();
    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));
      const targetDir = `${userSkillsDir(linuxUser)}/${skillId}`;
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
    } finally {
      sshPool.release(connection);
    }
  }

  async uninstallSkill(linuxUser: string, skillId: string): Promise<void> {
    if (!isValidSkillId(skillId)) {
      throw new SkillsError(400, '无效的 skillId');
    }

    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

      const targetDir = `${userSkillsDir(linuxUser)}/${skillId}`;

      // Delete skill directory (idempotent)
      await runAsUser(`rm -rf ${escapeShellArg(targetDir)}`);

      // Remove from manifest and lock
      await this.removeFromManifestAndLock(runAsUser, linuxUser, skillId);
    } finally {
      sshPool.release(connection);
    }
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
      const targetDir = `${userDir}/${skill.id}`;

      const sourceCheck = await runAsUser(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
        continue;
      }

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
      const version = normalizeVersion(parsed.data.version).version;

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
    status: SkillInfo['status']
  ): Promise<SkillInfo | null> {
    try {
      const catResult = await exec(`cat ${escapeShellArg(skillFilePath)}`);
      if (catResult.exitCode !== 0) return null;
      const skillId = skillFilePath.split('/').slice(-2, -1)[0];
      if (!isValidSkillId(skillId)) return null;
      return toSkillInfo(skillId, catResult.stdout, source, status);
    } catch {
      return null;
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
