# MyCC Skill Center Integration API

> Date: 2026-05-31
> Scope: skill listing, install, update, enable, disable, uninstall, usage events, and admin debug.

This document is the handoff contract for wiring the skill center into mainline UI or another MyCC client. The skill center is catalog-driven: clients should treat MyCC catalog/registry as the only install and update source.

## Publish Skill

Current v1 publishing is catalog/registry publishing, not browser file upload:

1. Add the skill package under `mycc-backend/src/skills/catalog/<skillId>/SKILL.md`.
2. Add a `SkillDefinition` entry in `mycc-backend/src/skills/skill-registry.ts`.
3. Set:
   - `trigger`: the stable slash entry, for example `/deep-research`
   - `triggers`: slash and natural-language triggers
   - `version`: optional; defaults to `1.0.0`
   - `preloadInImage: true` only when the skill should ship inside the E2B assistant image
   - `imageRequired: true` when the skill depends on image/runtime capabilities such as browser-use or Chromium
4. If `preloadInImage` is true, add the skill id to `mycc-backend/src/skills/image-preload-skills.json`.
5. Run:

```bash
cd mycc-sandbox
npm run skills:sync
```

6. Rebuild/create the E2B template when image-preloaded skills changed.

Release gates:

```bash
cd mycc-backend
npm test -- src/routes/skills.test.ts src/skills/skill-registry.test.ts src/skills/remote-skill-store.test.ts src/skills/skills-service.test.ts --run
npx tsc --noEmit

cd ../mycc-web-react
npm run test:run -- src/components/SkillsPage.test.tsx src/api/skills.test.ts src/components/chat/ChatInput.test.tsx
npm run typecheck

cd ../mycc-sandbox
npm test -- test/sandbox-contract.test.mjs
npm run smoke:local-contract
```

The tests enforce that published ready skills have slash and natural-language triggers, catalog files exist, and image-preloaded skills are mirrored into the sandbox template manifest.

## Frontend Client

Use the typed client in:

`mycc-web-react/src/api/skills.ts`

Recommended imports:

```ts
import {
  listSkills,
  subscribeSkill,
  installSkill,
  updateSkill,
  enableSkill,
  disableSkill,
  uninstallSkill,
  type SkillItem,
  type SkillsListResult,
  useSkill,
  getSkillDebugSnapshot,
} from "../api/skills";
```

`updateSkill()` maps to the backend `/upgrade` route. The UI should label this as "更新"; the backend route name is kept for compatibility.

## Auth

All endpoints require:

```http
Authorization: Bearer <jwt>
Content-Type: application/json
```

All responses use:

```ts
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

## List Skills

```http
GET /api/skills
```

Response:

```ts
interface SkillsListResult {
  skills: SkillItem[];
  total: number;
  catalogAvailable: boolean;
}

interface SkillItem {
  id: string;
  assistantSkillName?: string;
  name: string;
  description: string;
  trigger: string;
  triggers?: string[];
  icon: string;
  status: "installed" | "available" | "disabled";
  installed: boolean;
  version: string;
  installedVersion: string | null;
  latestVersion: string;
  source: string;
  legacy: boolean;
  enabled: boolean;
  upgradable: boolean;
  stats?: {
    downloads: number;
    installs: number;
    updates: number;
    uses: number;
  };
}
```

Client behavior:

- Installed section: `skills.filter(skill => skill.installed)`.
- Market section: `skills.filter(skill => !skill.installed)`.
- Search can be local over `id/name/description/trigger/triggers` for the current v1 surface.
- Display `latestVersion`, `installedVersion`, `upgradable`, and `stats` when present.
- Use `trigger` as the stable slash prefill. Use `triggers` to display and match both slash and natural-language triggers.
- Treat `id` as the MyCC market/API/statistics key. Treat `assistantSkillName` as the Claude-visible skill name from `SKILL.md` frontmatter `name`; runtime install paths must use `assistantSkillName`, not the market id.

## Subscribe Skill

```http
POST /api/skills/:skillId/subscribe
```

Request body:

```json
{}
```

Response is the same as install:

```ts
interface SkillInstallResult {
  skillId: string;
  installed: true;
  version: string;
  source: "catalog";
  targetPath: string;
}
```

Mainline UI should prefer "订阅" for market skills. Subscription means copying the catalog skill into the current user's runtime Claude skills directory under the sandbox home, not under the project workspace:

```text
/home/<linuxUser>/.claude/skills/<assistantSkillName>
```

`POST /api/skills/:skillId/install` remains available as a compatibility alias for older clients.

## Install Skill

```http
POST /api/skills/:skillId/install
```

Request body:

```json
{}
```

Response:

```ts
interface SkillInstallResult {
  skillId: string;
  installed: true;
  version: string;
  source: "catalog";
  targetPath: string;
}
```

`targetPath` is the runtime Claude skills install target, for example:

```text
/home/mycc_u1/.claude/skills/deep-research
```

The route parameter remains `skillId`, but the final directory name is the Claude skill name from `SKILL.md` frontmatter `name` when it differs. For example, a market skill with id `browser` can install to:

```text
/home/mycc_u1/.claude/skills/webapp-testing
```

The backend installs only from the MyCC catalog. It does not fall back to ClawHub.

Events:

- The backend records `download` before install starts.
- The backend records `install` after install succeeds.
- The backend records `install_failed` if install fails.

## Image Preload Contract

Runtime install/update and image preload are separate paths:

- Runtime install/update writes to `/home/<linuxUser>/.claude/skills/<assistantSkillName>`.
- Image preload is a build-time concern. It seeds the E2B assistant image so a new sandbox already contains base skills.
- Skill Center API calls do not mutate an existing image. Adding or removing an image-preloaded skill requires syncing the sandbox template and rebuilding/creating the E2B template.

The preload source of truth is the MyCC skill registry:

- Mark a skill definition with `preloadInImage: true` in `mycc-backend/src/skills/skill-registry.ts`.
- Keep `mycc-backend/src/skills/image-preload-skills.json` in sync with that registry flag. Backend tests enforce this.
- The skill package source must exist under `mycc-backend/src/skills/catalog/<skillId>/SKILL.md`; the sandbox/runtime install directory is still based on the package `SKILL.md` `name` field.

Sandbox sync flow:

```bash
cd mycc-sandbox
npm run skills:sync
```

The sync script reads `mycc-backend/src/skills/image-preload-skills.json`, copies catalog skills into `mycc-sandbox/templates/e2b-assistant-sandbox/skills`, and writes:

```text
mycc-sandbox/templates/e2b-assistant-sandbox/skills/.mycc-preload-skills.json
```

Docker then copies that directory to `/opt/mycc/skills` and seeds:

```text
/home/mycc/.claude/skills
```

The sandbox contract reads `.mycc-preload-skills.json` and verifies every preloaded skill exists in `/home/mycc/.claude/skills`.

## Update Skill

```http
POST /api/skills/:skillId/upgrade
```

Request body:

```json
{}
```

Response:

```ts
interface SkillActionResult {
  skillId: string;
  success: true;
  version?: string;
  source?: "catalog";
  targetPath?: string;
}
```

Mainline UI should call the frontend `updateSkill(token, skillId)` helper and label the action as "更新".

Update behavior:

- The skill must already exist under the user's Claude skills directory.
- The backend replaces the installed skill from the MyCC catalog.
- The backend preserves the previous enabled/disabled state.
- The backend returns the same `targetPath` contract as install.
- The backend records `update` after update succeeds and `update_failed` if update fails.

## Enable Or Disable Skill

```http
POST /api/skills/:skillId/enable
POST /api/skills/:skillId/disable
```

Request body:

```json
{}
```

Response:

```ts
interface SkillActionResult {
  skillId: string;
  success: true;
  enabled: boolean;
}
```

## Uninstall Skill

```http
POST /api/skills/:skillId/uninstall
```

Request body:

```json
{}
```

Response:

```ts
interface SkillActionResult {
  skillId: string;
  success: true;
  uninstalled: true;
}
```

Uninstall is idempotent from the client perspective.

## Record Skill Use

```http
POST /api/skills/:skillId/use
```

Request body:

```json
{}
```

Response:

```ts
interface SkillActionResult {
  skillId: string;
  success: true;
}
```

The current UI records this event when the user clicks "使用" and then navigates back to chat with the trigger prefilled. If event recording fails, callers should still continue the user's primary action.

## Admin Debug Snapshot

```http
GET /api/skills/debug
```

Requires `role: "admin"` in the JWT.

Response:

```ts
interface SkillDebugSnapshot {
  catalogAvailable: boolean;
  marketCount: number;
  installedCount: number;
  availableCount: number;
  upgradableCount: number;
  imagePreloadCount: number;
  imageRequiredCount: number;
  skills: Array<{
    id: string;
    name: string;
    triggers?: string[];
    source: string;
    status: "installed" | "available" | "disabled";
    installed: boolean;
    enabled: boolean;
    version: string;
    installedVersion: string | null;
    latestVersion: string;
    upgradable: boolean;
    preloadInImage?: boolean;
    imageRequired?: boolean;
    stats?: {
      downloads: number;
      installs: number;
      updates: number;
      uses: number;
    };
  }>;
}
```

The Skills page exposes this as "调试中心". It is intentionally operational, not a user onboarding surface:

- It shows whether catalog fallback is available.
- It compares installed, available, market, upgradable, image-preloaded, and image-required counts.
- It lists source/status/version/triggers/image metadata/stats for every visible skill.
- Non-admin users receive the backend permission error and can continue using the normal skill center.

## Error Handling

Expected errors:

- `400 无效的 skillId`
- `404 技能不存在于目录中`
- `404 技能未安装，无法升级`
- `403 需要管理员权限` for debug snapshot
- `503 技能运行环境尚未就绪，请稍后重试`
- `504 安装技能超时，请稍后重试` or `升级技能超时，请稍后重试`

The frontend client throws `Error(errorMessage)` when `success !== true` or HTTP status is not OK. UI callers should display `error.message`.

## Mainline Wiring Checklist

- Use `listSkills()` as the single source for installed and market sections.
- Do not call `/api/skills/market` for install/update UI state.
- Use `subscribeSkill()` for market subscription, keep `installSkill()` only for compatibility, and use `updateSkill()` for update.
- Call `useSkill()` before navigating to chat when a user clicks "使用"; ignore use-event failures.
- After any write action, reload `listSkills()`.
- Use `getSkillDebugSnapshot()` only in admin/internal tooling.
- Show `targetPath` only as a technical confirmation or debug detail; do not require users to understand it.
- Keep detailed descriptions optional until registry or `SKILL.md` metadata is richer.
