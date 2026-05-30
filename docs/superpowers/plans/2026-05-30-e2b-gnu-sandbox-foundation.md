# E2B GNU Sandbox Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first implementation slice for a user-image GNU sandbox that includes ccr-router, code-server, Python/Node/GNU tooling, and desktop prerequisites without changing the existing code-server product path.

**Architecture:** Keep E2B Cloud as the sandbox provider for Phase 1. Add template contract checks and template packages for sandbox-local ccr-router and GNU desktop dependencies, while preserving the existing `/api/ide` behavior and MyCC proxy security model.

**Tech Stack:** TypeScript, Vitest, E2B template Dockerfile, Ubuntu 22.04 packages, `@musistudio/claude-code-router`, code-server, Claude Code, Claude Agent SDK.

---

### Task 1: Extend E2B Template Contract

**Files:**
- Modify: `mycc-backend/src/ide/e2b-template-contract.ts`
- Modify: `mycc-backend/src/ide/e2b-template-contract.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

```ts
buildE2bTemplateContractCommand({
  requireCcrRouter: true,
  requireDesktop: true,
  requirePythonRuntime: true,
})
```

Expected assertions:

- command includes `ccr`
- command includes `Xvfb`, `startxfce4`, `x11vnc`, `websockify`, `dbus-launch`, `xdpyinfo`
- command includes `python3 -m venv`, `pip`, and a small Python runtime smoke

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
cd mycc-backend && npm test -- --run src/ide/e2b-template-contract.test.ts
```

Expected: FAIL because `requireCcrRouter`, `requireDesktop`, and `requirePythonRuntime` do not exist yet.

- [x] **Step 3: Implement minimal contract support**

Add the three options and map them to command checks without printing secrets.

- [x] **Step 4: Run test to verify it passes**

Run the same test command. Expected: PASS.

### Task 2: Update E2B User Image Template

**Files:**
- Modify: `mycc-backend/templates/e2b-code-server/e2b.Dockerfile`
- Modify: `mycc-backend/templates/e2b-code-server/template.ts`
- Modify: `mycc-backend/templates/e2b-code-server/README.md`

- [x] **Step 1: Add desktop and ccr-router package expectations**

Install Ubuntu desktop prerequisites and global `@musistudio/claude-code-router`.

- [x] **Step 2: Extend ready command**

Add ready checks for `ccr`, `Xvfb`, `startxfce4`, `x11vnc`, `websockify`, `dbus-launch`, and `xdpyinfo`.

- [x] **Step 3: Document the template contract**

Update README to describe ccr-router, code-server, Python/Node/GNU tooling, and desktop services as user-image capabilities.

### Task 3: Verify Existing Product Path

**Files:**
- No production code changes expected outside the contract/template files above.

- [x] **Step 1: Run focused tests**

```bash
cd mycc-backend && npm test -- --run src/ide/e2b-template-contract.test.ts src/ide/e2b-provider.test.ts src/routes/ide.test.ts
```

Expected: PASS.

- [x] **Step 2: Run build if focused tests pass**

```bash
cd mycc-backend && npm run build
```

Expected: PASS.
