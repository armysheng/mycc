# MyCC Personal Assistant Product Model

Date: 2026-05-30
Branch: `codex/e2b-architecture-next`

## Positioning

MyCC is an out-of-the-box personal assistant that understands the user, keeps working across sessions, and exposes its work only when the user needs to review, confirm, or take over.

The product should not present itself primarily as a Claude Code UI, an online IDE, or a sandbox console. Those are power capabilities behind the assistant.

North star:

> MyCC is a personal assistant that can remember context, take tasks, produce deliverables, and open its workbench when the user wants to inspect or intervene.

## Product Hierarchy

User-facing hierarchy:

1. Assistant
2. Task
3. Deliverable
4. Memory
5. Workspace
6. Capability

Engineering-facing hierarchy:

```text
User
  -> AssistantProfile
  -> Memory
  -> Task
      -> Run
      -> Event
      -> Deliverable
      -> ChangeSet
  -> Workspace
      -> Sandbox
      -> Capability(code-server, desktop, preview, terminal)
```

The first four objects are product concepts. `Workspace`, `Sandbox`, and `Capability` are implementation concepts that should be visible only when useful.

## Mental Model

The main user questions are:

- What can my assistant help me with right now?
- What is it already working on?
- What needs my confirmation?
- What did it produce?
- If I need to inspect or take over, where do I go?

The product should avoid making users ask:

- Which sandbox am I in?
- Which IDE session is active?
- Which provider/runtime is configured?
- Which port or proxy should I open?

Those details belong in status badges, diagnostics, or advanced workbench panels.

## First Screen

The first screen should be assistant-first:

1. Primary input: "What should I help with?"
2. Active tasks: running, waiting for confirmation, blocked, recently completed.
3. Recent deliverables: reports, code changes, links, screenshots, documents, PRs.
4. Assistant memory status: profile, preferences, project context, last updated.
5. Quick capabilities: open workbench, open code editor, review files, continue last task.

The first screen should not be a file explorer, IDE, task table, or runtime dashboard.

## Navigation Model

Recommended top-level surfaces:

- `Home`: assistant entry point, active work, recent deliverables.
- `Chat`: direct conversation with the assistant.
- `Tasks`: all tasks and their states.
- `Deliverables`: searchable output library.
- `Memory`: what the assistant knows and uses.
- `Workbench`: advanced review and intervention surface.

For v0, this can be implemented without a large route migration:

- Keep `/` as the assistant/chat entry.
- Keep `/workspace` as the workbench route.
- Introduce assistant-first sections gradually on the current chat page or a new home shell.

## Core Objects

### Assistant

The assistant is the user's relationship with MyCC. It owns identity, tone, memory, preferred workflows, and default capabilities.

User-facing examples:

- "My assistant knows my current project."
- "My assistant remembers my writing style."
- "My assistant can use the E2B workspace when it needs to code."

### Task

A task is a unit of work the assistant can start, continue, pause, resume, or finish.

Task states:

- `draft`: user has described intent but the assistant has not started.
- `running`: assistant is working.
- `waiting`: assistant needs user approval, credentials, clarification, or review.
- `blocked`: assistant cannot continue without external change.
- `completed`: task has a useful outcome.
- `archived`: no longer active.

Task examples:

- "调研 Claude Code UI"
- "把 E2B code-server 沙盒接起来"
- "生成一份产品方案"
- "修复登录页样式"

### Run

A run is one attempt or continuation of a task. A task can have many runs.

Examples:

- Initial run
- Continue run
- Verification run
- Retry after user feedback

Runs are useful for engineering and audit, but the user mostly sees task progress.

### Deliverable

A deliverable is anything the assistant produces that the user may want to keep, review, share, or reuse.

Deliverable kinds:

- `document`
- `code_change`
- `diff`
- `report`
- `link`
- `preview`
- `screenshot`
- `log`
- `pr`
- `dataset`

Deliverables are more user-friendly than "artifacts". Internally, `Artifact` can remain the technical model, but the UI should say "制品" or "交付物" depending on tone.

### Memory

Memory is what makes MyCC feel like a personal assistant rather than a generic chatbot.

Memory categories:

- Identity: who the user is, assistant name, language, preferred tone.
- Preferences: design taste, coding style, tools, default providers.
- Project context: current repo, architecture, deployment rules, pitfalls.
- Working context: active tasks, last decisions, open blockers.

Memory should be inspectable and correctable. The product should make it safe to ask "why do you know this?" and "forget/change this."

### Workspace

Workspace is where the assistant works. It may be local, SSH-backed, or E2B-backed.

Current v0 constraint:

- The active E2B workspace is user-scoped, not task-scoped.
- Chat `sessionId` does not currently imply a dedicated sandbox.

The UI should say "current active E2B workspace" until a future task-to-sandbox mapping exists.

### Capability

Capabilities are tools the assistant can open or use:

- `code-server`: deep code editing.
- `desktop`: future GNU desktop / noVNC / E2B Desktop.
- `preview`: app/browser preview.
- `terminal`: future controlled shell surface.
- `files`: workspace file browser.

Capabilities should be launched from tasks or workbench, not promoted as the product's primary identity.

## Page Model

### Home

Purpose: help the user start or continue useful work.

Sections:

- Assistant prompt: large input with suggested starts.
- Continue cards: unfinished tasks and waiting confirmations.
- Recent deliverables: last useful outputs.
- Memory card: what MyCC currently knows.
- Health strip: subtle runtime readiness, hidden unless attention is needed.

### Task Detail

Purpose: make one piece of work inspectable.

Sections:

- Task title, status, owner, last update.
- Conversation and progress narrative.
- Waiting approvals or questions.
- Deliverables.
- Changes.
- Workbench entry points.

### Deliverables

Purpose: make outputs durable and reusable.

Sections:

- Recent outputs.
- Filter by type.
- Search by task/project/date.
- Open source task.
- Open file or preview.

### Memory

Purpose: build trust and personalization.

Sections:

- About me.
- Preferences.
- Project context.
- Recent decisions.
- Suggested memory updates.
- Forget/edit controls.

### Workbench

Purpose: advanced review and intervention.

Sections:

- Files.
- Changes.
- Deliverables/artifacts.
- Capabilities.
- Diagnostics.

Workbench should be one click away from task detail, but it should not be the default first screen.

## UX Principles

- Assistant-first language: say "I can help", "waiting for your confirmation", "delivered", not "session initialized" or "provider active" unless debugging.
- Progressive disclosure: hide sandbox/code-server/provider details until they matter.
- Deliverable orientation: every non-trivial task should try to end with something reviewable.
- Memory transparency: show what the assistant used, and let the user edit it.
- Safe takeover: code-server and desktop are escape hatches for power users.
- Mobile-friendly review: mobile should support approval, reading, and follow-up, not deep editing.

## Relationship To Workbench v0

`docs/superpowers/specs/2026-05-30-mycc-workbench-v0-design.md` defines the advanced workbench.

This product model sits above it:

- Home and task detail are assistant-first.
- Workbench is capability-first.
- Code-server and E2B Desktop belong inside workbench/capabilities.
- Deliverables and tasks are visible from both layers.

## v0 Scope

The first implementation should focus on product framing, not new runtime behavior.

In scope:

- Rename and reframe UX copy around assistant, task, deliverable, and workspace.
- Add home/task summary sections where current data exists.
- Show "current active E2B workspace" instead of implying per-task sandbox isolation.
- Make code-server an advanced action, not the main workspace purpose.
- Add deliverable/changes empty states that teach the model.
- Add a v0 contract that maps today's conversations, files, and memory sources into assistant-facing concepts without pretending the future task/artifact model already exists.

Out of scope:

- Per-task E2B sandbox allocation.
- Full artifact registry.
- E2B Desktop/noVNC.
- Raw terminal surface.
- Complex multi-agent orchestration UI.

## Data Model Direction

Near-term mapping:

```text
Conversation/sessionId -> task-like context
Current IDE session -> active user workspace
Workspace files -> file panel
Tool/file outputs -> future deliverables
Runtime preflight -> health strip
```

Future mapping:

```text
task_id
  -> conversation_id
  -> sandbox_id
  -> runs[]
  -> deliverables[]
  -> changesets[]
  -> approvals[]
```

Do not pretend the future mapping already exists in v0. The UI must label today's scope honestly.

## v0 Contract

This section freezes the first implementation contract so parallel work does not invent incompatible data assumptions.

### Conversation-As-Task

Until a `tasks` table exists, the UI may present recent conversations as task-like cards.

Allowed v0 labels:

- `recent`: conversation has messages but no live run state.
- `active`: current chat request is streaming in the browser session.
- `waiting`: there is a visible permission or plan approval prompt in the current browser session.
- `needs_workspace`: the current user has no active E2B workspace when workspace-backed file access is required.

Disallowed v0 labels unless backed by persistent data:

- `blocked`
- `completed`
- `failed`
- `verified`

Reason: current persistent conversation records do not store task status, run status, approval status, or completion state. The UI can say "recent conversation" or "continue this", but it should not claim durable task state.

### Workspace Ownership

In v0, workspace state is user-scoped:

```text
conversation/sessionId -> chat history context only
current IDE session -> current user's active E2B workspace
```

Required UI copy:

- "Current active E2B workspace"
- "This workspace is shared by your current assistant coding work."
- "This conversation does not yet have a dedicated sandbox."

Disallowed UI copy:

- "Task sandbox"
- "Session workspace"
- "This task's files"

Those phrases should wait until a future `task_id -> sandbox_id` or `conversation_id -> sandbox_id` mapping exists.

### Memory Source Of Truth

v0 should show memory as a layered view rather than a single editable blob.

Known sources:

1. Assistant profile and onboarding fields from the user account.
2. Workspace project context such as `0-System/about-me` and `0-System/memory`.
3. Runtime soul memory under the chat runtime memory files.

v0 memory UI rules:

- Display sources separately with labels such as `Profile`, `Project context`, and `Runtime memory`.
- Editing is allowed only for sources that the current backend can safely write.
- If a source is read-only in v0, show it as read-only.
- "Forget" must specify which source will be changed. Do not provide global forget unless all runtime injection paths are updated.
- When memory is used in a chat request, the UI should prefer "may be used by the assistant" over "will always be used" unless the exact injection path is known.

### Derived Deliverables

Deliverables are core to the product, but v0 does not have a durable artifact registry. To avoid an empty product shell, v0 can show derived deliverables from safe existing sources.

Allowed derived sources:

- Markdown files under the active workspace that look like reports, specs, plans, or summaries.
- Recently opened or edited workspace files when metadata is available.
- Chat messages containing explicit links.
- Existing local docs/plans/specs when surfaced from the active workspace file tree.

Disallowed derived sources:

- Arbitrary shell command output.
- Secrets or environment files.
- Raw provider URLs or E2B hosts.
- Tool logs that are not already visible to the authenticated user.

Derived deliverable cards must be labeled as "from current workspace" or "from current conversation" so users understand the source.

### Minimal API Contract

If adding backend aggregation in v0, use stable, read-only endpoints:

```text
GET /api/assistant/home
GET /api/assistant/memory
GET /api/assistant/deliverables
GET /api/workbench/summary
GET /api/workbench/capabilities
```

These endpoints may return partial data, but they must not leak:

- E2B upstream host
- `trafficAccessToken`
- raw `proxyToken`
- CCR or provider base URL
- provider credentials

Launch URLs may include an existing short-lived `openPath` token, but only as a URL string intended for immediate navigation.

### v0 Empty States

Empty states must teach the model:

- No tasks: "Start by asking your assistant to do something. Recent conversations will appear here."
- No deliverables: "Useful outputs like reports, files, previews, and PRs will appear here after the assistant produces them."
- No memory: "Your assistant can become more useful when it knows your preferences and project context."
- No workspace: "Create an E2B workspace when you want the assistant to work with files or code."

### v0 Tests

Product model tests should verify:

- Home does not show durable task states without backing data.
- `sessionId` copy does not imply a dedicated sandbox.
- Memory sources are labeled separately.
- Deliverable cards show their source.
- Secret-like provider and E2B fields are absent from assistant/workbench payloads.
- code-server appears as an advanced capability, not the primary product identity.

## Risks

- If the UI leads with Workbench, MyCC will feel like an engineering console instead of a personal assistant.
- If the UI hides Workbench too much, power users cannot trust or inspect the assistant's work.
- If deliverables are not first-class, tasks feel like chat transcripts rather than outcomes.
- If memory is invisible, personalization feels magical but untrustworthy.
- If sandbox/session ownership is unclear, users may misunderstand which task changed which files.

## Recommendation

Adopt an assistant-first product shell:

1. First screen: prompt, active tasks, waiting confirmations, recent deliverables, memory status.
2. Task detail: progress, conversation, deliverables, changes, workbench entry.
3. Workbench: files, capabilities, code-server, future desktop.

This keeps MyCC easy to start with while preserving the advanced agent workbench that makes it powerful.
