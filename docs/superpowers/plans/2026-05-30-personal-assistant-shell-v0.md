# Personal Assistant Shell v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe MyCC from a chat/workspace utility into an assistant-first product shell with safe v0 task-like cards, memory source cards, derived deliverable placeholders, and advanced workbench capabilities.

**Architecture:** Add read-only assistant aggregation endpoints that map existing conversations, user profile, IDE session, and safe placeholder deliverables into assistant-facing concepts. Then update the React entry experience to show assistant-first summary cards while keeping chat as the primary action and code-server as an advanced capability.

**Tech Stack:** Fastify + TypeScript + Vitest backend; React 19 + Vite + Vitest frontend; existing JWT auth, conversations table, IDE session store, workspace APIs.

---

## File Structure

- Create `mycc-backend/src/routes/assistant.ts`: authenticated read-only assistant endpoints.
- Create `mycc-backend/src/routes/assistant.test.ts`: route contract tests for auth, task-like mapping, memory source labels, deliverable empty state, and secret redaction.
- Modify `mycc-backend/src/index.ts`: register assistant routes.
- Modify `mycc-web-react/src/config/api.ts`: add assistant endpoint helpers.
- Modify `mycc-web-react/src/types.ts`: add assistant shell response types.
- Create `mycc-web-react/src/components/assistant/AssistantHomePanel.tsx`: assistant-first summary cards shown on empty or top-level chat state.
- Create `mycc-web-react/src/components/assistant/AssistantHomePanel.test.tsx`: component tests for copy, states, and secret-safe rendering.
- Modify `mycc-web-react/src/components/ChatPage.tsx`: load assistant home data and render the assistant panel without disrupting current chat flow.
- Modify `mycc-web-react/src/components/chat/ChatMessages.tsx`: replace generic empty state with assistant-first language and optional home panel slot.
- Modify `mycc-web-react/src/components/WorkspacePage.tsx`: rename "Remote IDE" copy to broader "E2B workspace / code editor" copy without changing behavior.
- Modify `mycc-web-react/src/components/WorkspacePage.test.tsx`: update expected copy and ensure no sandbox-per-session implication.

Do not touch `docs/plans/2026-05-30-e2b-desktop-architecture.md`; it is unrelated untracked work.

## Parallelization Boundaries

- Task 1 and Task 4 may run in parallel. They touch disjoint backend and workspace-copy surfaces.
- Task 2 must wait for Task 1's response contract or use the contract below exactly.
- Task 3 must wait for Task 2 because it consumes `AssistantHomePanel` props and types.
- Task 5 runs after all implementation tasks.
- Do not let multiple agents edit `mycc-web-react/src/types.ts`, `mycc-web-react/src/components/ChatPage.tsx`, or `mycc-web-react/src/components/chat/ChatMessages.tsx` at the same time.

## Backend Response And Dependency Contract

`assistantRoutes` must accept injected dependencies so tests do not use the real database:

```ts
export type AssistantRoutesOptions = {
  getUserConversations?: typeof getUserConversations;
  findUserById?: typeof findUserById;
  ideSessionStore?: IdeSessionStore;
};
```

Default implementations should use existing `db/client` functions and `PostgresIdeSessionStore`.

All assistant endpoints must return only safe public fields. They must never return raw upstream `host`, `trafficAccessToken`, `proxyToken`, provider base URL, or provider credentials. Existing `openPath` may be returned only as a launch URL string for immediate navigation.

---

### Task 1: Backend Assistant Read Model

**Files:**
- Create: `mycc-backend/src/routes/assistant.ts`
- Create: `mycc-backend/src/routes/assistant.test.ts`
- Modify: `mycc-backend/src/index.ts`

- [ ] **Step 1: Write failing route tests**

Create `mycc-backend/src/routes/assistant.test.ts` with tests for:

```ts
it('requires auth for assistant home', async () => {
  const app = Fastify();
  await app.register(assistantRoutes, testOptions);
  const res = await app.inject({ method: 'GET', url: '/api/assistant/home' });
  expect(res.statusCode).toBe(401);
});

it('maps conversations to recent task-like cards without durable task states', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/assistant/home',
    headers: authHeader(),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.data.tasks[0]).toMatchObject({
    status: 'recent',
    source: 'conversation',
  });
  expect(body.data.tasks[0].status).not.toMatch(/blocked|completed|failed|verified/);
});

it('labels memory sources separately', async () => {
  const body = await getAssistantHome();
  expect(body.data.memory.sources.map((item: any) => item.kind)).toEqual(
    expect.arrayContaining(['profile', 'project_context', 'runtime_memory']),
  );
});

it('does not leak provider or E2B secret fields', async () => {
  for (const url of ['/api/assistant/home', '/api/assistant/memory', '/api/assistant/deliverables']) {
    const res = await app.inject({ method: 'GET', url, headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const text = res.body;
    expect(text).not.toContain('trafficAccessToken');
    expect(text).not.toContain('proxyToken');
    expect(text).not.toContain('e2b_live_secret_123456');
    expect(text).not.toContain('e2b-traffic-access-token');
    expect(text).not.toMatch(/[a-z0-9-]+\\.e2b\\.app/i);
    expect(text).not.toContain('https://provider.example.com/secret-route');
    expect(text).not.toContain('sk-provider-secret');
  }
});
```

Use `InMemoryIdeSessionStore`, mocked `getUserConversations`, and mocked `findUserById` through route options so tests do not hit the real database. Seed the fake IDE session with deliberately sensitive `host`, `trafficAccessToken`, and `proxyToken` values to prove the route redacts them.

- [ ] **Step 2: Run backend test and confirm failure**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-backend
npm test -- src/routes/assistant.test.ts
```

Expected: FAIL because `assistantRoutes` does not exist.

- [ ] **Step 3: Implement `assistantRoutes`**

Create `mycc-backend/src/routes/assistant.ts`:

- Export `assistantRoutes(fastify, options = {})`.
- Define `AssistantRoutesOptions` with `getUserConversations`, `findUserById`, and `ideSessionStore`.
- Protect endpoints with `jwtAuthMiddleware`.
- Add `GET /api/assistant/home`.
- Add `GET /api/assistant/memory`.
- Add `GET /api/assistant/deliverables`.
- Map conversations to task-like cards using only `recent`.
- Build memory sources:
  - `profile`: assistant name, linux user, initialized state.
  - `project_context`: read-only placeholder with `status: 'available_when_workspace_running'`.
  - `runtime_memory`: read-only placeholder with `status: 'managed_by_runtime'`.
- Return deliverables as empty array plus instructional empty state.
- Include current IDE session only through safe public fields such as `status`, `provider`, `expiresAt`, and optional `openPath`.
- Never include raw `host`, `trafficAccessToken`, `proxyToken`, `sandboxId`, provider base URLs, or credentials in assistant payloads.

- [ ] **Step 4: Register routes**

Modify `mycc-backend/src/index.ts`:

```ts
import { assistantRoutes } from './routes/assistant.js';
...
await fastify.register(assistantRoutes);
```

Register after auth/chat routes and before workspace/ide routes.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-backend
npm test -- src/routes/assistant.test.ts
```

Expected: PASS.

---

### Task 2: Frontend Assistant API Types And Panel

**Files:**
- Modify: `mycc-web-react/src/config/api.ts`
- Modify: `mycc-web-react/src/types.ts`
- Create: `mycc-web-react/src/components/assistant/AssistantHomePanel.tsx`
- Create: `mycc-web-react/src/components/assistant/AssistantHomePanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `AssistantHomePanel.test.tsx` covering:

- Shows assistant-first headline: "今天要我帮你做什么？"
- Shows recent conversation cards as "最近继续" or "最近会话", not `blocked/completed`.
- Shows deliverable empty state.
- Shows memory sources as separate labeled cards.
- Shows code editor as an advanced capability.
- Does not render raw `openPath`, token query strings, `sandboxId`, upstream host, E2B token, or provider URL when those fields accidentally appear in fixture data.

- [ ] **Step 2: Run frontend test and confirm failure**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run test:run -- src/components/assistant/AssistantHomePanel.test.tsx
```

Expected: FAIL because component/types do not exist.

- [ ] **Step 3: Add API helpers and types**

Modify `mycc-web-react/src/config/api.ts`:

```ts
ASSISTANT: withBase('/api/assistant'),
...
export const getAssistantHomeUrl = () => `${API_CONFIG.ENDPOINTS.ASSISTANT}/home`;
export const getAssistantMemoryUrl = () => `${API_CONFIG.ENDPOINTS.ASSISTANT}/memory`;
export const getAssistantDeliverablesUrl = () => `${API_CONFIG.ENDPOINTS.ASSISTANT}/deliverables`;
```

Modify `mycc-web-react/src/types.ts` with `AssistantHomeData`, `AssistantTaskCard`, `AssistantDeliverableCard`, `AssistantMemorySource`, and `AssistantCapabilityCard`.

- [ ] **Step 4: Implement `AssistantHomePanel`**

The component should be presentational and accept:

```ts
type AssistantHomePanelProps = {
  assistantName: string;
  data: AssistantHomeData | null;
  loading?: boolean;
  error?: string | null;
  onStartPrompt?: (prompt: string) => void;
  onOpenWorkspace?: () => void;
};
```

Use clear copy:

- "今天要我帮你做什么？"
- "最近可以继续"
- "等待确认"
- "最近制品"
- "助理记忆"
- "高级工作间"

Do not render raw `openPath` values, token query strings, `sandboxId`, upstream host, E2B tokens, or provider URLs. The panel can expose a button action via callbacks, but should not display launch URLs as text.

- [ ] **Step 5: Run frontend component test**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run test:run -- src/components/assistant/AssistantHomePanel.test.tsx
```

Expected: PASS.

---

### Task 3: Integrate Assistant Panel Into Chat Entry

**Files:**
- Modify: `mycc-web-react/src/components/ChatPage.tsx`
- Modify: `mycc-web-react/src/components/chat/ChatMessages.tsx`
- Test: existing chat tests if affected; add focused test only if needed.

- [ ] **Step 1: Add a failing integration test if existing test coverage allows**

If there is an existing `ChatPage` test harness, add a test that mocks `/api/assistant/home` and verifies the assistant home panel appears before any messages.

If there is no stable harness, skip new integration test and rely on `AssistantHomePanel` unit tests plus typecheck.

- [ ] **Step 2: Load assistant home data in `ChatPage`**

Add state:

```ts
const [assistantHome, setAssistantHome] = useState<AssistantHomeData | null>(null);
const [assistantHomeLoading, setAssistantHomeLoading] = useState(false);
const [assistantHomeError, setAssistantHomeError] = useState<string | null>(null);
```

Fetch `getAssistantHomeUrl()` with auth headers after token is available. Fail softly.

- [ ] **Step 3: Render assistant panel in empty chat state**

Pass a `homePanel` prop into `ChatMessages` or render above the message list when:

```ts
messages.length === 0 && !isLoadedConversation && !isHistoryView
```

The panel's suggested prompt click should call `setInput(prompt)`.

- [ ] **Step 4: Keep loaded conversations unchanged**

Ensure `sessionId` history view still shows history messages and does not imply a dedicated sandbox.

- [ ] **Step 5: Verify frontend**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run typecheck
npm run test:run -- src/components/assistant/AssistantHomePanel.test.tsx
```

Expected: PASS.

---

### Task 4: Reframe Workspace Copy As Advanced Workbench

**Files:**
- Modify: `mycc-web-react/src/components/WorkspacePage.tsx`
- Modify: `mycc-web-react/src/components/WorkspacePage.test.tsx`

- [ ] **Step 1: Update expected copy tests first**

Change test expectations:

- "E2B 工作区需要 Remote IDE" -> "E2B 工作区需要代码编辑器"
- "先打开 Remote IDE" -> "创建 E2B 工作区"
- "打开 Remote IDE" -> "打开代码编辑器"

Add an assertion that page copy includes "当前活跃 E2B 工作区" when E2B is active.

- [ ] **Step 2: Run focused workspace tests and confirm failures**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run test:run -- src/components/WorkspacePage.test.tsx
```

Expected: FAIL due to old copy.

- [ ] **Step 3: Update `WorkspacePage.tsx` copy only**

Change labels without changing behavior:

- `Workspace Studio` -> `Assistant Workbench`
- `工作区文件编辑` -> `助理工作间`
- `打开 Remote IDE` -> `打开代码编辑器`
- `E2B sandbox 已连接` -> `当前活跃 E2B 工作区已连接`
- `Remote IDE` where conceptually broader -> `E2B 工作区`
- Keep technical details in secondary text only.

- [ ] **Step 4: Run workspace tests**

Run:

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run test:run -- src/components/WorkspacePage.test.tsx
```

Expected: PASS.

---

### Task 5: Final Verification And Commits

**Files:**
- All files touched above.

- [ ] **Step 1: Run backend focused tests**

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-backend
npm test -- src/routes/assistant.test.ts src/routes/chat.runtime-config.test.ts src/routes/ide.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused tests**

```bash
cd /Users/armysheng/workspace/mycc-main/mycc-web-react
npm run test:run -- src/components/assistant/AssistantHomePanel.test.tsx src/components/WorkspacePage.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

```bash
cd /Users/armysheng/workspace/mycc-main
git diff --stat
git status --short
```

Expected: only assistant shell/workbench copy files plus this plan. Do not include `docs/plans/2026-05-30-e2b-desktop-architecture.md`.

- [ ] **Step 4: Commit backend slice**

```bash
git add mycc-backend/src/routes/assistant.ts mycc-backend/src/routes/assistant.test.ts mycc-backend/src/index.ts
git commit -m "feat(assistant): add personal assistant read model"
```

- [ ] **Step 5: Commit frontend slice**

```bash
git add mycc-web-react/src/config/api.ts mycc-web-react/src/types.ts mycc-web-react/src/components/assistant mycc-web-react/src/components/ChatPage.tsx mycc-web-react/src/components/chat/ChatMessages.tsx mycc-web-react/src/components/WorkspacePage.tsx mycc-web-react/src/components/WorkspacePage.test.tsx
git commit -m "feat(ui): add assistant-first home shell"
```

- [ ] **Step 6: Commit plan if not already committed**

```bash
git add docs/superpowers/plans/2026-05-30-personal-assistant-shell-v0.md
git commit -m "docs(plan): add assistant shell v0 implementation plan"
```
