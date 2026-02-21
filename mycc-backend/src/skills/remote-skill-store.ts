import matter from 'gray-matter';
import { getSSHPool } from '../ssh/pool.js';
import { escapeShellArg } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import type { SkillInfo } from './types.js';

type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
type CatalogCacheEntry = { path: string; expiresAt: number };

const ICON_MAP: Record<string, string> = {
  'cc-usage': '📊',
  'mycc': '📱',
  'read-gzh': '📖',
  'tell-me': '💬',
  'scheduler': '⏰',
  'setup': '🛠',
  'dashboard': '📋',
  'skill-creator': '🔧',
  'mycc-regression': '🔄',
};

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

  return {
    id: skillId,
    name: (parsed.data.name as string) || skillId,
    description: (parsed.data.description as string) || '',
    trigger: `/${skillId}`,
    icon: ICON_MAP[skillId] || '⚡',
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

export class RemoteSkillStore {
  private static catalogCache = new Map<string, CatalogCacheEntry>();

  async listSkillInfos(linuxUser: string): Promise<{ skills: SkillInfo[]; catalogAvailable: boolean }> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));
      const installedDir = userSkillsDir(linuxUser);
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      const manifest = await this.readManifest(runAsUser, linuxUser);

      const installedResult = await runAsUser(
        `find ${escapeShellArg(installedDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
      );
      const availableResult = catalogDir
        ? await run(
            `find ${escapeShellArg(catalogDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
          )
        : { stdout: '', stderr: '', exitCode: 0 };

      const installedPaths = installedResult.stdout.trim().split('\n').filter(Boolean);
      const availablePaths = availableResult.stdout.trim().split('\n').filter(Boolean);
      const map = new Map<string, SkillInfo>();

      for (const path of availablePaths) {
        const skill = await this.readSkillInfo(run, path, 'catalog', 'available');
        if (skill) {
          map.set(skill.id, skill);
        }
      }

      for (const path of installedPaths) {
        const skill = await this.readSkillInfo(runAsUser, path, 'user', 'installed');
        if (skill) {
          const existed = map.get(skill.id);
          if (existed) {
            const installedVersion = skill.version;
            const latestVersion = existed.latestVersion || installedVersion;
            const disabled = Boolean(manifest?.skills?.[skill.id]?.disabled);
            map.set(skill.id, {
              ...existed,
              status: disabled ? 'disabled' : 'installed',
              installed: true,
              installedVersion,
              version: installedVersion,
              enabled: !disabled,
              upgradable: installedVersion !== latestVersion,
              legacy: existed.legacy && skill.legacy,
            });
          } else {
            const disabled = Boolean(manifest?.skills?.[skill.id]?.disabled);
            skill.status = disabled ? 'disabled' : 'installed';
            skill.enabled = !disabled;
            skill.upgradable = false;
            map.set(skill.id, skill);
          }
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
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      if (!catalogDir) {
        throw new SkillsError(503, '未找到技能目录，已尝试自动初始化但失败');
      }

      const sourceDir = `${catalogDir}/${skillId}`;
      const targetBaseDir = userSkillsDir(linuxUser);
      const targetDir = `${targetBaseDir}/${skillId}`;

      const sourceCheck = await run(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
        throw new SkillsError(404, '技能不存在于目录中');
      }

      await runAsUser(`mkdir -p ${escapeShellArg(targetBaseDir)}`);
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
      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      if (!catalogDir) {
        throw new SkillsError(503, '未找到技能目录，无法升级');
      }
      const sourceDir = `${catalogDir}/${skillId}`;
      const targetBaseDir = userSkillsDir(linuxUser);
      const targetDir = `${targetBaseDir}/${skillId}`;

      if (sourceDir === targetDir) {
        const currentSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
        const parsedCurrent = matter(currentSkill.stdout || '');
        return normalizeVersion(parsedCurrent.data.version).version;
      }

      const sourceCheck = await run(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
        throw new SkillsError(404, '技能不存在于目录中');
      }
      if (!targetCheck.stdout.trim()) {
        throw new SkillsError(404, '技能未安装，无法升级');
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
      const manifest = await this.readManifest(runAsUser, linuxUser);
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
      const check = await execAsUser(
        `[ -d ${escapeShellArg(cached.path)} ] && echo ok || true`
      );
      if (check.stdout.trim()) {
        return cached.path;
      }
      RemoteSkillStore.catalogCache.delete(linuxUser);
    }

    const explicit = process.env.SKILLS_CATALOG_DIR?.trim();
    if (explicit) {
      const ready = await exec(`[ -d ${escapeShellArg(explicit)} ] && echo ok || true`);
      if (ready.stdout.trim()) {
        this.cacheCatalogPath(linuxUser, explicit);
        return explicit;
      }
    }

    const candidates = [
      '/opt/mycc/.claude/skills',
      '/opt/mycc/mycc/.claude/skills',
      '/opt/mycc/skills',
      '/home/mycc/.claude/skills',
    ];

    for (const candidate of candidates) {
      const check = await exec(`[ -d ${escapeShellArg(candidate)} ] && echo ${escapeShellArg(candidate)} || true`);
      if (check.stdout.trim()) {
        this.cacheCatalogPath(linuxUser, candidate);
        return candidate;
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

  private cacheCatalogPath(linuxUser: string, path: string): void {
    RemoteSkillStore.catalogCache.set(linuxUser, {
      path,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }

  private async bootstrapCatalog(exec: ExecFn, linuxUser: string): Promise<string | null> {
    const catalogDir = userCatalogSeedDir(linuxUser);
    const seedFrom = userSkillsDir(linuxUser);

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
# 最后回退：生成基础内置 skills，确保系统可用
mkdir -p "$CATALOG/tell-me" "$CATALOG/scheduler" "$CATALOG/cc-usage" "$CATALOG/mycc-regression"
cat > "$CATALOG/tell-me/SKILL.md" <<'SKILL'
---
name: tell-me
description: 通知与摘要助手
version: 1.0.0
source: mycc-builtin
triggers:
  - /tell-me
---

你是 tell-me 助手。根据用户请求，整理摘要并给出结构化结果。
SKILL
cat > "$CATALOG/scheduler/SKILL.md" <<'SKILL'
---
name: scheduler
description: 自动化任务编排助手
version: 1.0.0
source: mycc-builtin
triggers:
  - /scheduler
---

你是 scheduler 助手。帮助用户创建、审查和优化自动化任务。
SKILL
cat > "$CATALOG/cc-usage/SKILL.md" <<'SKILL'
---
name: cc-usage
description: Claude Code 用量分析助手
version: 1.0.0
source: mycc-builtin
triggers:
  - /cc-usage
---

你是 cc-usage 助手。分析会话成本与 token 使用情况并给建议。
SKILL
cat > "$CATALOG/mycc-regression/SKILL.md" <<'SKILL'
---
name: mycc-regression
description: 回归验证助手
version: 1.0.0
source: mycc-builtin
triggers:
  - /mycc-regression
---

你是 mycc-regression 助手。执行并输出可复现的回归检查清单。
SKILL
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
}
