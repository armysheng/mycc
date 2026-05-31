# Skill Install Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MyCC skill install and update reliable, catalog-driven, and explicit about the Claude skills install target.

**Architecture:** Keep the skill center independent from agent runtime execution. The registry and catalog describe available skills, while install and update copy catalog content into the user's Claude skills directory under `.claude/skills/<skillId>`. UI details use only metadata already available from the registry or parsed `SKILL.md`.

**Tech Stack:** Fastify, TypeScript, Vitest, React, Vite.

---

### Task 1: Backend Install And Update Contract

**Files:**
- Modify: `mycc-backend/src/skills/types.ts`
- Modify: `mycc-backend/src/skills/remote-skill-store.test.ts`
- Modify: `mycc-backend/src/skills/remote-skill-store.ts`
- Modify: `mycc-backend/src/skills/skills-service.ts`

- [x] Write failing tests that install never calls ClawHub and returns version, source, and target path.
- [x] Write failing tests that update replaces the installed skill from catalog and preserves disabled state.
- [x] Implement a shared install/update result shape with `source` and `targetPath`.
- [x] Remove ClawHub fallback from install/update main path.
- [x] Run backend skill tests.

### Task 2: Frontend Install And Update Surface

**Files:**
- Modify: `mycc-web-react/src/components/SkillsPage.tsx`

- [x] Show available version and source on skill cards.
- [x] Keep existing install/update buttons but make processing state clear.
- [x] Use existing metadata only; avoid invented long descriptions.
- [x] Run frontend typecheck or targeted test command.

### Task 3: Mainline Integration Contract

**Files:**
- Create: `mycc-web-react/src/api/skills.ts`
- Create: `mycc-web-react/src/api/skills.test.ts`
- Create: `docs/mycc-skill-center-integration.md`
- Modify: `mycc-web-react/src/components/SkillsPage.tsx`

- [x] Add a typed frontend API client for list/install/update/enable/disable/uninstall.
- [x] Cover the typed client contract with focused tests.
- [x] Wire SkillsPage through the typed client instead of direct URL/fetch calls.
- [x] Document the backend contract for mainline integration.

### Task 4: Version, Usage Stats, And Debug Contract

**Files:**
- Modify: `mycc-backend/src/skills/types.ts`
- Modify: `mycc-backend/src/skills/skill-registry.ts`
- Modify: `mycc-backend/src/skills/remote-skill-store.ts`
- Modify: `mycc-backend/src/skills/skills-service.ts`
- Create: `mycc-backend/src/skills/skill-events.ts`
- Modify: `mycc-backend/src/routes/skills.ts`
- Modify: `mycc-backend/src/db/client.ts`
- Modify: `mycc-backend/db/schema.sql`
- Create: `mycc-backend/db/migrations/005-add-skill-events.sql`
- Modify: `mycc-web-react/src/api/skills.ts`
- Modify: `mycc-web-react/src/components/SkillsPage.tsx`
- Modify: `docs/mycc-skill-center-integration.md`

- [x] Use registry/default version when a known catalog skill lacks `version` in `SKILL.md`.
- [x] Add `skill_events` storage for download/install/update/use/uninstall events.
- [x] Merge per-skill aggregate stats into `GET /api/skills`.
- [x] Record install/update/use events through service methods.
- [x] Add `POST /api/skills/:skillId/use`.
- [x] Add read-only admin `GET /api/skills/debug` as the first debug center contract.
- [x] Display downloads and uses on skill cards.
