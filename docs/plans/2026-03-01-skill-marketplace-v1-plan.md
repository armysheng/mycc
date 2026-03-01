# Skill Marketplace V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor skill marketplace to registry-driven curated market with install/uninstall/enable/disable lifecycle and new UI.

**Architecture:** `skill-registry.json` is the single source of truth for market skills. `RemoteSkillStore` merges registry data with user's installed skills directory. External sources (ClawHub/SkillsMP) are bypassed entirely. Frontend is a single-page two-section layout (Installed / Recommended) with detail modal.

**Tech Stack:** Backend: Fastify + TypeScript, SSH remote execution. Frontend: React 19 + Vite + Tailwind CSS.

**Design Doc:** `docs/plans/2026-03-01-skill-marketplace-v1-design.md`

---

### Task 1: Create skill-registry.json

**Files:**
- Create: `mycc-backend/src/skills/skill-registry.json`

**Step 1: Create the registry file with all 10 curated skills**

```json
{
  "version": 1,
  "skills": [
    {
      "id": "tell-me",
      "name": "通知与摘要助手",
      "description": "整理摘要并发送通知到飞书群",
      "icon": "💬",
      "category": "工具",
      "triggers": ["/tell-me"],
      "source": "registry",
      "defaultInstall": true,
      "examplePrompt": "帮我总结今天的对话要点"
    },
    {
      "id": "scheduler",
      "name": "自动化任务编排",
      "description": "帮助创建、审查和优化自动化任务",
      "icon": "⏰",
      "category": "工具",
      "triggers": ["/scheduler"],
      "source": "registry",
      "defaultInstall": true,
      "examplePrompt": "帮我创建一个每天早上 9 点的提醒"
    },
    {
      "id": "cc-usage",
      "name": "用量分析",
      "description": "分析会话成本与 token 使用情况",
      "icon": "📊",
      "category": "工具",
      "triggers": ["/cc-usage"],
      "source": "registry",
      "defaultInstall": true,
      "examplePrompt": "看看今天的 token 消耗"
    },
    {
      "id": "mycc-regression",
      "name": "回归检查",
      "description": "执行并输出可复现的回归检查清单",
      "icon": "🔄",
      "category": "开发",
      "triggers": ["/mycc-regression"],
      "source": "registry",
      "defaultInstall": true,
      "examplePrompt": "跑一下回归测试"
    },
    {
      "id": "read-gzh",
      "name": "读公众号",
      "description": "读取微信公众号文章并总结",
      "icon": "📖",
      "category": "工具",
      "triggers": ["/read-gzh"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "帮我读一下这篇公众号文章"
    },
    {
      "id": "dashboard",
      "name": "能力看板",
      "description": "可视化查看 cc 能力看板",
      "icon": "📋",
      "category": "工具",
      "triggers": ["/dashboard"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "看看能力看板"
    },
    {
      "id": "skill-creator",
      "name": "创建技能",
      "description": "创建新的 Claude Code Skill",
      "icon": "🔧",
      "category": "开发",
      "triggers": ["/skill-creator"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "帮我创建一个新技能"
    },
    {
      "id": "code-review",
      "name": "代码审查",
      "description": "审查代码质量、风格和潜在问题",
      "icon": "🔍",
      "category": "开发",
      "triggers": ["/code-review"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "帮我审查一下最近的代码改动"
    },
    {
      "id": "docs-writer",
      "name": "文档写作",
      "description": "协助撰写技术文档和说明",
      "icon": "📝",
      "category": "工具",
      "triggers": ["/docs-writer"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "帮我写一份 API 文档"
    },
    {
      "id": "web-summarize",
      "name": "网页摘要",
      "description": "抓取网页内容并生成摘要",
      "icon": "🌐",
      "category": "工具",
      "triggers": ["/web-summarize"],
      "source": "registry",
      "defaultInstall": false,
      "examplePrompt": "帮我总结一下这个网页"
    }
  ]
}
```

**Step 2: Commit**

```bash
git add mycc-backend/src/skills/skill-registry.json
git commit -m "feat(skills): add skill registry with 10 curated skills"
```

---

### Task 2: Update backend types

**Files:**
- Modify: `mycc-backend/src/skills/types.ts`
- Modify: `mycc-backend/src/skills/contracts.ts`

**Step 1: Add registry types and uninstall result to types.ts**

Add to `types.ts`:

```typescript
export interface RegistrySkillEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  triggers: string[];
  source: 'registry';
  defaultInstall: boolean;
  examplePrompt?: string;
}

export interface SkillRegistry {
  version: number;
  skills: RegistrySkillEntry[];
}
```

Add `uninstalled?: boolean` to `SkillActionResult`.

Add `examplePrompt?: string` to `SkillInfo`.

**Step 2: Add uninstallSkill to contracts.ts**

Add to `ISkillsService`:

```typescript
uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult>;
```

**Step 3: Commit**

```bash
git add mycc-backend/src/skills/types.ts mycc-backend/src/skills/contracts.ts
git commit -m "feat(skills): add registry types, uninstall to contract"
```

---

### Task 3: Refactor RemoteSkillStore — bypass external sources, add registry merge

**Files:**
- Modify: `mycc-backend/src/skills/remote-skill-store.ts`

This is the biggest backend change. Three sub-tasks:

**Step 1: Add registry loading**

At top of `remote-skill-store.ts`, add import and loader:

```typescript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillRegistry, RegistrySkillEntry } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadRegistry(): SkillRegistry {
  const raw = readFileSync(join(__dirname, 'skill-registry.json'), 'utf-8');
  return JSON.parse(raw);
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
```

**Step 2: Refactor listSkillInfos() — remove ClawHub merge, add registry merge**

Replace the ClawHub merge block (lines ~148-159 in current code) and add registry merge at the beginning of the method:

```typescript
async listSkillInfos(linuxUser: string): Promise<{ skills: SkillInfo[]; catalogAvailable: boolean }> {
    const sshPool = getSSHPool();
    const connection = await sshPool.acquire();

    try {
      const run: ExecFn = (command) => sshPool.exec(connection, command);
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
```

**Step 3: Refactor searchSkills() — local-only search**

Replace current implementation:

```typescript
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
```

**Step 4: Refactor installSkill() — remove ClawHub fallback**

Remove the ClawHub try/catch block (lines ~210-229 in current code). The method should:
1. Check if already installed → return early
2. Resolve catalog dir
3. Copy from catalog to user dir
4. Update manifest/lock
5. No ClawHub fallback

**Step 5: Add uninstallSkill()**

```typescript
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
```

**Step 6: Add removeFromManifestAndLock() private method**

```typescript
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
```

**Step 7: Add autoBootstrapDefaults() method for first-time install**

```typescript
private static bootstrapLocks = new Map<string, Promise<void>>();

  async autoBootstrapDefaults(linuxUser: string): Promise<void> {
    const existing = RemoteSkillStore.bootstrapLocks.get(linuxUser);
    if (existing) {
      await existing;
      return;
    }

    const doBootstrap = async () => {
      const sshPool = getSSHPool();
      const connection = await sshPool.acquire();
      try {
        const runAsUser: ExecFn = (command) =>
          sshPool.exec(connection, runAsLinuxUserCommand(linuxUser, command));

        const manifest = await this.readManifest(runAsUser, linuxUser);
        if (manifest?.bootstrapped) return;

        const registry = loadRegistry();
        const defaults = registry.skills.filter((s) => s.defaultInstall);

        for (const entry of defaults) {
          const targetDir = `${userSkillsDir(linuxUser)}/${entry.id}`;
          const check = await runAsUser(
            `[ -d ${escapeShellArg(targetDir)} ] && echo ok || true`
          );
          if (check.stdout.trim()) continue;

          // Try install from catalog (best-effort)
          try {
            await this.installSkill(linuxUser, entry.id);
          } catch {
            // Skill may not exist in catalog yet — skip silently
          }
        }

        // Mark bootstrapped
        const manifestPath = skillsManifestPath(linuxUser);
        const script = `
MANIFEST=${escapeShellArg(manifestPath)}
export MANIFEST
node <<'NODE'
const fs = require('fs');
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } };
const m = readJson(process.env.MANIFEST, { version: 1, skills: {} });
m.bootstrapped = true;
m.updatedAt = new Date().toISOString();
fs.writeFileSync(process.env.MANIFEST, JSON.stringify(m, null, 2));
NODE
`;
        await runAsUser(script);
      } finally {
        sshPool.release(connection);
        RemoteSkillStore.bootstrapLocks.delete(linuxUser);
      }
    };

    const promise = doBootstrap();
    RemoteSkillStore.bootstrapLocks.set(linuxUser, promise);
    await promise;
  }
```

**Step 8: Update bootstrapCatalog() to use registry**

Replace the hardcoded 4 skills in the `bootstrapCatalog` method with a loop over `loadRegistry().skills`, generating a SKILL.md for each entry.

**Step 9: Commit**

```bash
git add mycc-backend/src/skills/remote-skill-store.ts
git commit -m "feat(skills): registry-driven listing, local search, uninstall, auto-bootstrap"
```

---

### Task 4: Update SkillsService and routes

**Files:**
- Modify: `mycc-backend/src/skills/skills-service.ts`
- Modify: `mycc-backend/src/routes/skills.ts`

**Step 1: Add uninstallSkill to SkillsService**

```typescript
async uninstallSkill(context: SkillsContext, skillId: string): Promise<SkillActionResult> {
    this.validateContext(context);
    this.validateSkillId(skillId);
    await this.executeSkillOperation(
      () => this.store.uninstallSkill(context.linuxUser, skillId),
      ACTION_TIMEOUT_MS,
      '卸载技能超时，请稍后重试'
    );
    return { skillId, success: true, uninstalled: true };
  }
```

**Step 2: Add auto-bootstrap call in listSkills**

In `listSkills()`, before calling `this.store.listSkillInfos()`, add:

```typescript
// First-time auto-bootstrap (idempotent, per-user lock)
await this.store.autoBootstrapDefaults(context.linuxUser);
```

**Step 3: Add uninstall route to skills.ts**

```typescript
fastify.post('/api/skills/:skillId/uninstall', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    try {
      const { skillId } = request.params as { skillId: string };
      const user = await withUser(request.user.userId);
      const data = await skillsService.uninstallSkill({
        userId: request.user.userId,
        linuxUser: user.linux_user,
      }, skillId);
      return reply.send({ success: true, data });
    } catch (err) {
      if (err instanceof SkillsError) {
        return reply.status(err.statusCode).send({ success: false, error: err.message });
      }
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '卸载技能失败',
      });
    }
  });
```

**Step 4: Commit**

```bash
git add mycc-backend/src/skills/skills-service.ts mycc-backend/src/routes/skills.ts
git commit -m "feat(skills): add uninstall API, auto-bootstrap on first listSkills"
```

---

### Task 5: Verify backend build

**Step 1: Run backend build**

```bash
cd mycc-backend && npm run build
```

Expected: PASS, no TypeScript errors.

**Step 2: Fix any compilation errors found**

**Step 3: Commit if fixes needed**

```bash
git add -A && git commit -m "fix(skills): resolve build issues"
```

---

### Task 6: Add frontend API helper for uninstall

**Files:**
- Modify: `mycc-web-react/src/config/api.ts`

**Step 1: Add getSkillUninstallUrl**

```typescript
export const getSkillUninstallUrl = (skillId: string) => {
  return `${getBaseUrl()}/api/skills/${encodeURIComponent(skillId)}/uninstall`;
};
```

**Step 2: Commit**

```bash
git add mycc-web-react/src/config/api.ts
git commit -m "feat(frontend): add skill uninstall API URL helper"
```

---

### Task 7: Rewrite SkillsPage — new two-section layout with detail modal

**Files:**
- Rewrite: `mycc-web-react/src/components/SkillsPage.tsx`

This is the largest frontend change. The new page has:

1. **Header** — title + refresh button
2. **Search bar** — full width, debounced
3. **Installed section** — two-column grid, cards with toggle switch
4. **Recommended section** — two-column grid, cards with + button
5. **Detail modal** — icon, name, version, description, example prompt, triggers, actions (uninstall/enable-disable/try)

**Step 1: Rewrite SkillsPage.tsx**

Key design decisions for the implementor:
- Single-page layout, NOT tabs. Two sections: "已安装" and "推荐"
- When searching: merge results into a single flat list (no sections)
- Cards: minimal — icon, name, short description, action button
- Toggle switch for installed skills (enable/disable)
- `+` button for recommended skills (install)
- Click card body → open detail modal
- Detail modal actions: 卸载 (confirm first), 禁用/启用, 试用 (navigate to chat with prefill)
- Uninstalled recommended skills show 安装 button in modal instead of 卸载/禁用
- Use existing CSS variables (`--accent`, `--bg-surface`, `--text-primary`, etc.)
- Import `getSkillUninstallUrl` from api config
- Mobile responsive: single column on small screens, two columns on md+

The `SkillItem` interface needs `examplePrompt?: string` added.

API calls to add:
- `callSkillAction` needs to handle `"uninstall"` action using `getSkillUninstallUrl`
- Uninstall should use `window.confirm('确定要卸载该技能吗？')` before proceeding

**Step 2: Commit**

```bash
git add mycc-web-react/src/components/SkillsPage.tsx
git commit -m "feat(frontend): new two-section skills page with detail modal"
```

---

### Task 8: Clean up SkillList panel component

**Files:**
- Modify: `mycc-web-react/src/components/panel/SkillList.tsx`

**Step 1: Update SkillList to match new SkillInfo shape**

Ensure the `SkillItem` type in `types/toolbox.ts` (or wherever used) includes `examplePrompt`. Check if `SkillList.tsx` is still used in the sidebar panel — if so, update badge logic. If not used elsewhere, leave as-is.

**Step 2: Commit if changed**

```bash
git add mycc-web-react/src/components/panel/SkillList.tsx
git commit -m "fix(frontend): update SkillList for new skill shape"
```

---

### Task 9: Verify frontend build

**Step 1: Run frontend build**

```bash
cd mycc-web-react && npm run build
```

Expected: PASS, no TypeScript errors.

**Step 2: Fix any issues found**

**Step 3: Commit if fixes needed**

```bash
git add -A && git commit -m "fix(frontend): resolve build issues"
```

---

### Task 10: Smoke test — end-to-end verification

Using the webapp-testing skill or manual verification:

**Step 1: Start backend and frontend locally or on test VPS**

**Step 2: Verify these scenarios**

1. **List**: `GET /api/skills` returns only registry + installed skills, no ClawHub source
2. **Search**: `GET /api/skills/search?q=通知` returns matching local skills only
3. **Install**: `POST /api/skills/read-gzh/install` succeeds
4. **Uninstall**: `POST /api/skills/read-gzh/uninstall` succeeds
5. **Idempotent uninstall**: Repeat uninstall → success
6. **Enable/Disable**: Toggle works
7. **UI**: Skills page shows two sections, detail modal opens, actions work
8. **History compat**: Previously installed skills not in registry appear in installed section

**Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "fix(skills): smoke test fixes"
```

---

### Task 11: Final commit and PR preparation

**Step 1: Verify both builds pass**

```bash
cd mycc-backend && npm run build
cd ../mycc-web-react && npm run build
```

**Step 2: Review all changes**

```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
```

**Step 3: Ready for PR or merge**

Use `superpowers:finishing-a-development-branch` skill to decide merge strategy.
