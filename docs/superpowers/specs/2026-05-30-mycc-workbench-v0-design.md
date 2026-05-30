# MyCC Workbench v0 Design

Date: 2026-05-30
Branch: `codex/e2b-architecture-next`

## Purpose

MyCC should evolve from a lightweight workspace file editor into a Codex-like agent workbench. The workbench should make an agent task feel inspectable: users can see the conversation, task status, file changes, produced artifacts, logs, and deep-edit entry points without needing to treat the built-in Monaco editor as a full IDE.

This design keeps `code-server` as the real IDE and treats E2B Desktop as a future capability. Workbench v0 focuses on information architecture and product surfaces that can be implemented incrementally on top of the current E2B code-server + Claude Agent SDK path.

## References

- `cdesktop`: session sidebar, transcript, terminal/diff, right-side plan/files/preview panes.
- `OpenCockpit`: multi-project cockpit, tabs, browser/DB bubbles, code review flow.
- `CloudCLI / claudecodeui`: mobile-friendly project/session hub and remote CLI control. Reference only because it is AGPL-3.0.
- `code-server`: browser IDE. Reuse rather than rebuilding VS Code.
- `E2B Desktop`: future GNU desktop capability. Keep out of v0 implementation except for capability slots.

## Goals

- Make `/workspace` a task workbench, not just a file tree plus Monaco.
- Give users a stable mental model: project, session, event stream, artifacts, file changes, and remote capabilities.
- Keep heavy editing in `code-server`; use Monaco only for quick file inspection and small edits.
- Introduce a first-class "capabilities" area for `code-server`, future GNU desktop, previews, and sandbox health.
- Prepare the UI and API shape for artifacts without requiring a full artifact registry in the first patch.
- Keep v0 implementable with today's data model: chat `sessionId` may select chat history, but files and IDE capabilities represent the current user's active E2B workspace.

## Non-Goals

- Do not clone VS Code in MyCC.
- Do not directly import AGPL UI code from CloudCLI/opcode/HAPI.
- Do not implement E2B Desktop/noVNC in Workbench v0.
- Do not build a full persistent artifact registry in the first UI pass.
- Do not change the existing chat/runtime execution model unless a later implementation plan requires it.

## Current State

The current `/workspace` page provides:

- File tree from `/api/workspace/tree`.
- File read/save through `/api/workspace/file`.
- E2B Remote IDE status and `openPath`.
- Monaco editor for quick file edits.

The current chat page provides:

- Streaming conversation.
- Plan and permission UX.
- Runtime status badge for Agent SDK, CCR, code-server workspace, and E2B preflight.

The gap is that task outputs are split across chat, workspace, and remote IDE. Users cannot quickly answer: what did the agent do, what changed, what can I review, and where should I intervene?

## Product Model

Workbench v0 uses five panels:

1. Project/session rail
2. Chat/session context
3. Review panel with empty or placeholder artifacts and changes
4. Workspace files panel
5. Capabilities launcher

The core user flow is:

1. User starts or opens a task/session.
2. Workbench shows the selected chat context and active E2B workspace state.
3. Files remain inspectable through the current workspace APIs.
4. User sees where artifacts and changes will appear, even if v0 only renders empty states or derived placeholders.
5. If deeper intervention is needed, user opens code-server or, later, GNU desktop.

## Layout

### Desktop

Recommended layout:

- Left rail: project/session navigation, latest status, and active task list.
- Center: conversation/session context and workbench status.
- Right inspector: tabs for `Artifacts`, `Changes`, `Files`, and `Capabilities`.

The right inspector is the main upgrade over the current `/workspace` page. It lets users review outputs without leaving the conversation.

### Mobile

Use one primary column with bottom or top tabs:

- `Chat`
- `Artifacts`
- `Changes`
- `Files`
- `Tools`

The mobile version should favor review and approval over deep editing. Deep editing opens `code-server` in a new tab.

## Workbench Routes

Keep the current routes initially, but change their meaning:

- `/` remains the chat-first entry.
- `/workspace` becomes the Workbench route.
- `?sessionId=` should let `/workspace` open a specific conversation context.

Do not introduce a large route migration in v0. The first implementation can progressively enhance `WorkspacePage.tsx`.

Important v0 constraint: the current E2B workspace and IDE session are scoped to the user, not to a chat `sessionId`. In v0, `sessionId` must not imply a dedicated sandbox. The UI should label this clearly as "current active E2B workspace" until a future conversation-to-sandbox mapping exists.

## Backend API Shape

Workbench v0 can start with aggregator endpoints that wrap existing data. Avoid forcing every frontend component to know where chat, workspace, and IDE state live.

Suggested target endpoints:

- `GET /api/workbench/summary?sessionId=...`
- `GET /api/workbench/artifacts?sessionId=...`
- `GET /api/workbench/changes?sessionId=...`
- `GET /api/workbench/capabilities`

For v0, these can be thin adapters:

- Summary can combine conversation metadata, runtime config, and current IDE session.
- Artifacts can return an empty stable list or explicitly derived placeholder records.
- Changes can return an empty stable list until a safe read-only sandbox runner is added.
- Capabilities can expose `code-server` status and future `desktop` feature availability.

If implementation time is tight, frontend may first compose existing endpoints, but the target shape should still be documented as above.

Do not implement a full event stream in Phase 1 or Phase 2. Current real-time events are tied to the active chat SSE response, and historical tool events are not yet normalized into a durable workbench event store.

## Artifact Model

Claude Agent SDK does not provide a reusable Claude.ai-style artifact registry. MyCC should own this model.

Workbench v0 should introduce the display contract without requiring all storage to exist:

```ts
type WorkbenchArtifact = {
  id: string;
  sessionId?: string;
  kind: 'file' | 'diff' | 'preview' | 'report' | 'log' | 'screenshot' | 'link';
  title: string;
  status: 'pending' | 'ready' | 'error';
  path?: string;
  url?: string;
  mimeType?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
```

Initial artifact sources:

- Files written or edited by tools.
- Markdown reports in the workspace.
- Preview URLs emitted by commands.
- Smoke/test logs.
- Future screenshots from browser/VNC tasks.

For Phase 1 and Phase 2, artifacts should be treated as a display contract and empty-state UX. Real persistence and ingestion belong to Phase 4.

## Changes Model

The `Changes` tab should become the review surface:

- List changed files.
- Show status: added, modified, deleted, renamed.
- Open quick preview in Monaco.
- Offer `Open in code-server` for deep editing.

Implementation should not run arbitrary shell commands. When changes are implemented, use a backend-owned read-only runner with a whitelist such as `git status --porcelain` and `git diff --name-status`, fixed workspace cwd, short timeouts, output size limits, and secret-path filtering for `.env`, credential files, and provider config.

## Capabilities Model

Capabilities are user-facing entry points into the sandbox:

```ts
type WorkbenchCapability = {
  id: 'code-server' | 'desktop' | 'preview' | 'terminal';
  label: string;
  status: 'available' | 'running' | 'disabled' | 'needs-session' | 'error';
  description: string;
  openPath?: string;
  actionLabel?: string;
};
```

For v0:

- `code-server`: available/running based on current IDE config/session.
- `desktop`: hidden by default; keep only the type slot or feature flag until E2B Desktop lands.
- `preview`: placeholder for future app preview.
- `terminal`: avoid exposing a raw terminal until sandbox permissions and audit logging are clear.

## Frontend Components

Suggested component split:

- `WorkbenchPage`: layout and data orchestration.
- `WorkbenchHeader`: current session, sandbox status, and primary actions.
- `WorkbenchEventStream`: conversation/task event display.
- `WorkbenchInspector`: right-side tabs.
- `ArtifactsPanel`: artifact cards and previews.
- `ChangesPanel`: changed file list and diff/preview actions.
- `WorkspaceFilesPanel`: current file tree and Monaco quick view.
- `CapabilitiesPanel`: code-server and future desktop launchers.

This split lets multiple agents work independently later:

- One agent can build data hooks and API types.
- One agent can build `ArtifactsPanel` and `ChangesPanel`.
- One agent can refactor `WorkspacePage` into the workbench layout.

## Backend Components

Suggested component split:

- `src/workbench/types.ts`: shared backend response types.
- `src/workbench/service.ts`: summary aggregation.
- `src/routes/workbench.ts`: Fastify routes.
- Future: `src/artifacts/store.ts` for persistent artifact registry.

Do not move existing IDE/session code in v0. Workbench should consume it.

## Error Handling

- If E2B workspace has no running session, show "Create E2B workspace" rather than "Open Remote IDE" only.
- If code-server is unavailable but sandbox exists, show "Restart code editor".
- If artifact metadata is missing, degrade to file/path cards.
- If workspace commands fail because the sandbox expired, mark the session stale and prompt for recreation.
- Never expose E2B host, traffic tokens, CCR URLs, or provider credentials in frontend payloads.
- Existing `openPath` values may include a short-lived open token. This is allowed for launching proxied services, but frontend code must not log, persist, or display that token. Tests should assert that raw fields such as `host`, `trafficAccessToken`, and `proxyToken` are not returned.

## Testing Strategy

Frontend:

- Workbench renders with no session.
- Workbench renders with running E2B code-server session.
- Capabilities panel does not leak provider host/token.
- Files panel still handles E2B `409 needs session` state.
- Artifacts/changes empty states are useful and not noisy.
- `sessionId` copy does not imply a dedicated sandbox.

Backend:

- Workbench summary combines runtime config and IDE session safely.
- Capabilities response hides secrets.
- Artifact placeholder route returns stable empty arrays before full registry exists.
- Auth is required on all workbench endpoints.
- Capability responses may include launch `openPath`, but not raw upstream host, traffic token, or proxy token fields.

Smoke:

- Existing E2B code-server smoke remains the release gate.
- Workbench v0 should not require E2B Desktop smoke.

## Rollout Plan

Phase 1: Workbench shell

- Refactor `/workspace` into a workbench layout.
- Rename user-facing copy from "Remote IDE" to "E2B workspace" where the concept is broader than code-server.
- Add capabilities panel with code-server entry.
- Keep files and IDE state scoped to the current user's active E2B workspace.

Phase 2: Review surfaces

- Add `Artifacts` and `Changes` tabs with useful empty states and stable placeholder data contracts.
- Add quick-open file previews.

Phase 3: Backend aggregation

- Add `/api/workbench/*` endpoints.
- Move frontend data loading from scattered endpoint calls to workbench summary where helpful.
- Add safe read-only changes collection only after runner constraints are implemented.

Phase 4: Full artifact registry

- Persist artifacts created from SDK events, tool outputs, file changes, previews, and screenshots.
- Add artifact status/versioning.

Phase 5: E2B Desktop integration

- Add desktop capability once the separate E2B Desktop design is approved.
- Keep desktop as a capability, not the main workbench.

## Open Questions

- Should `/workspace` and chat merge into one route immediately, or should `/workspace` remain a separate "review/workbench" surface for one release?
- Should artifacts be scoped to `conversation_id`, `session_id`, or both?
- Should Workbench v0 include a git diff implementation, or only a placeholder `Changes` tab until sandbox git commands are standardized?

## Recommendation

Start with Phase 1 and Phase 2. This gives users a much clearer Codex-like workspace quickly, while avoiding the largest backend/data-model migrations. In parallel, let the E2B Desktop work proceed as a separate capability track. Once desktop is ready, it can drop into the existing `CapabilitiesPanel` without reshaping the product again.
