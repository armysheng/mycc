# MyCC Skill Center Integration API

> Date: 2026-05-31
> Scope: skill listing, install, update, enable, disable, uninstall, usage events, and admin debug.

This document is the handoff contract for wiring the skill center into mainline UI or another MyCC client. The skill center is catalog-driven: clients should treat MyCC catalog/registry as the only install and update source.

## Frontend Client

Use the typed client in:

`mycc-web-react/src/api/skills.ts`

Recommended imports:

```ts
import {
  listSkills,
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
  name: string;
  description: string;
  trigger: string;
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
- Search can be local over `id/name/description/trigger` for the current v1 surface.
- Display `latestVersion`, `installedVersion`, `upgradable`, and `stats` when present.

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

`targetPath` is the Claude skills install target, for example:

```text
/home/mycc_u1/workspace/.claude/skills/deep-research
```

The backend installs only from the MyCC catalog. It does not fall back to ClawHub.

Events:

- The backend records `download` before install starts.
- The backend records `install` after install succeeds.
- The backend records `install_failed` if install fails.

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
  skills: Array<{
    id: string;
    name: string;
    source: string;
    status: "installed" | "available" | "disabled";
    installed: boolean;
    enabled: boolean;
    version: string;
    installedVersion: string | null;
    latestVersion: string;
    upgradable: boolean;
    stats?: {
      downloads: number;
      installs: number;
      updates: number;
      uses: number;
    };
  }>;
}
```

This is the first backend contract for a future skill debugging center. It is intentionally read-only in v1.

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
- Use `installSkill()` for install and `updateSkill()` for update.
- Call `useSkill()` before navigating to chat when a user clicks "使用"; ignore use-event failures.
- After any write action, reload `listSkills()`.
- Use `getSkillDebugSnapshot()` only in admin/internal tooling.
- Show `targetPath` only as a technical confirmation or debug detail; do not require users to understand it.
- Keep detailed descriptions optional until registry or `SKILL.md` metadata is richer.
