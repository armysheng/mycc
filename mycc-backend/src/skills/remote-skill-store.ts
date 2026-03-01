import matter from 'gray-matter';
import { getSSHPool } from '../ssh/pool.js';
import { escapeShellArg } from '../utils/validation.js';
import { SkillsError } from './errors.js';
import type { SkillInfo, RegistrySkillEntry } from './types.js';
import { SKILL_REGISTRY } from './skill-registry.js';

function loadRegistry() {
  return SKILL_REGISTRY;
}

function registryEntryToSkillInfo(entry: RegistrySkillEntry): SkillInfo {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    trigger: entry.triggers[0] || `/${entry.id}`,
    icon: entry.icon,
    status: 'available',
    installed: false,
    version: '1.0.0',
    installedVersion: null,
    latestVersion: '1.0.0',
    source: entry.source,
    legacy: false,
    enabled: false,
    upgradable: false,
    examplePrompt: entry.examplePrompt,
  };
}

function buildRegistrySkillMarkdown(entry: RegistrySkillEntry): string {
  const trigger = entry.triggers[0] || `/${entry.id}`;
  return `---
name: ${entry.id}
description: ${entry.description}
version: 1.0.0
source: mycc-registry
triggers:
  - ${trigger}
---

你是 ${entry.id} 助手。${entry.description}
`;
}

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
      const runAsUser: ExecFn = (command) =>
        sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));
      const installedDir = userSkillsDir(linuxUser);
      const manifest = await this.readManifest(runAsUser, linuxUser);

      // 1. Load registry as base
      const registry = loadRegistry();
      const map = new Map<string, SkillInfo>();

      for (const entry of registry.skills) {
        map.set(entry.id, registryEntryToSkillInfo(entry));
      }

      // 2. Merge installed skills from user directory
      const installedResult = await runAsUser(
        `find ${escapeShellArg(installedDir)} -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null || true`
      );
      const installedPaths = installedResult.stdout.trim().split('\n').filter(Boolean);

      for (const path of installedPaths) {
        const skill = await this.readSkillInfo(runAsUser, path, 'user', 'installed');
        if (skill) {
          const registryEntry = map.get(skill.id);
          const disabled = Boolean(manifest?.skills?.[skill.id]?.disabled);

          if (registryEntry) {
            // Registry has + installed: merge with registry metadata
            map.set(skill.id, {
              ...registryEntry,
              status: disabled ? 'disabled' : 'installed',
              installed: true,
              installedVersion: skill.version,
              version: skill.version,
              enabled: !disabled,
              upgradable: false,
            });
          } else {
            // Registry missing + installed: visible in installed only
            skill.status = disabled ? 'disabled' : 'installed';
            skill.enabled = !disabled;
            skill.upgradable = false;
            map.set(skill.id, skill);
          }
        }
      }

      // NO ClawHub merge — external sources bypassed

      const skills = Array.from(map.values()).sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      return { skills, catalogAvailable: true };
    } finally {
      sshPool.release(connection);
    }
  }

  async searchSkills(linuxUser: string, query: string): Promise<SkillInfo[]> {
    if (!query || query.trim().length < 2) {
      throw new SkillsError(400, '搜索关键词至少需要 2 个字符');
    }

    const q = query.trim().toLowerCase();

    // Get all skills (registry + installed) then filter
    const { skills } = await this.listSkillInfos(linuxUser);
    return skills.filter((s) =>
      [s.id, s.name, s.description, s.trigger].join(' ').toLowerCase().includes(q)
    );
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

      const targetDir = `${userSkillsDir(linuxUser)}/${skillId}`;
      const targetCheck = await runAsUser(`[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`);

      if (targetCheck.stdout.trim()) {
        // Already installed, return current version
        const catSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
        const parsed = matter(catSkill.stdout || '');
        return normalizeVersion(parsed.data.version).version;
      }

      let catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      if (!catalogDir) {
        catalogDir = await this.ensureCatalogForInstall(runAsUser, linuxUser);
      }
      if (!catalogDir) {
        throw new SkillsError(404, '未找到技能目录，请确认用户 workspace 已初始化');
      }

      const sourceDir = `${catalogDir}/${skillId}`;

      const sourceCheck = await run(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
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

      const manifest = await this.readManifest(runAsUser, linuxUser);

      const catalogDir = await this.resolveCatalogDir(run, runAsUser, linuxUser);
      if (!catalogDir) {
        throw new SkillsError(503, '未找到技能目录，无法升级');
      }
      const sourceDir = `${catalogDir}/${skillId}`;

      if (sourceDir === targetDir) {
        const currentSkill = await runAsUser(`cat ${escapeShellArg(`${targetDir}/SKILL.md`)} 2>/dev/null || true`);
        const parsedCurrent = matter(currentSkill.stdout || '');
        return normalizeVersion(parsedCurrent.data.version).version;
      }

      const sourceCheck = await run(`[ -d ${escapeShellArg(sourceDir)} ] && echo ok || true`);
      if (!sourceCheck.stdout.trim()) {
        throw new SkillsError(404, '技能不存在于目录中');
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

    // No catalog found — do not bootstrap implicitly
    return null;
  }

  private cacheCatalogPath(linuxUser: string, path: string): void {
    RemoteSkillStore.catalogCache.set(linuxUser, {
      path,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }

  private async ensureCatalogForInstall(execAsUser: ExecFn, linuxUser: string): Promise<string | null> {
    const catalogDir = userCatalogSeedDir(linuxUser);
    const skills = loadRegistry().skills.map((entry) => ({
      id: entry.id,
      markdown: buildRegistrySkillMarkdown(entry),
    }));
    const skillsB64 = Buffer.from(JSON.stringify(skills), 'utf8').toString('base64');

    const script = `
CATALOG=${escapeShellArg(catalogDir)}
SKILLS_B64=${escapeShellArg(skillsB64)}
export CATALOG SKILLS_B64

mkdir -p "$CATALOG"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const catalog = process.env.CATALOG;
const skills = JSON.parse(Buffer.from(process.env.SKILLS_B64, 'base64').toString('utf8'));

for (const skill of skills) {
  const dir = path.join(catalog, skill.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, skill.markdown, 'utf8');
  }
}

console.log(catalog);
NODE
`;

    const result = await execAsUser(script);
    if (result.exitCode !== 0) {
      return null;
    }
    const out = result.stdout.trim();
    const generatedPath = out ? out.split('\n').pop() || null : null;
    if (generatedPath) {
      this.cacheCatalogPath(linuxUser, generatedPath);
    }
    return generatedPath;
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
      throw new SkillsError(500, result.stderr || '清理技能状态失败');
    }
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
