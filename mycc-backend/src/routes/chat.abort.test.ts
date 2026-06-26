import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoutes } from "./chat.js";
import { InMemoryIdeSessionStore } from "../ide/session-store.js";
import { makeTestUser, makeTestUserLookup } from "../test/auth-mocks.js";

const mocks = vi.hoisted(() => ({
  appendConversationMessages: vi.fn(),
  checkQuota: vi.fn(),
  createAgentRuntime: vi.fn(),
  findUserById: vi.fn(),
  getConversationMessageSnapshots: vi.fn(),
  logUsage: vi.fn(),
  markUserInitialized: vi.fn(),
  renameConversation: vi.fn(),
  runtimeChat: vi.fn(),
  updateConversationStats: vi.fn(),
  upsertConversation: vi.fn(),
  userOwnsConversation: vi.fn(),
}));

vi.mock("../agent-runtime/index.js", () => ({
  createAgentRuntime: mocks.createAgentRuntime,
}));

vi.mock("../db/client.js", () => ({
  appendConversationMessages: mocks.appendConversationMessages,
  checkQuota: mocks.checkQuota,
  createUser: vi.fn(),
  findUserByCredential: vi.fn(),
  findUserById: mocks.findUserById,
  getConversationMessageSnapshots: mocks.getConversationMessageSnapshots,
  getSubscription: vi.fn(),
  getUserConversations: vi.fn(),
  logUsage: mocks.logUsage,
  markUserInitialized: mocks.markUserInitialized,
  pool: { query: vi.fn() },
  renameConversation: mocks.renameConversation,
  updateConversationStats: mocks.updateConversationStats,
  updateUserProfile: vi.fn(),
  upsertConversation: mocks.upsertConversation,
  userOwnsConversation: mocks.userOwnsConversation,
}));

const TEST_JWT_SECRET = "your_jwt_secret_change_in_production";

function authHeader(
  overrides: Partial<{ userId: number; linuxUser: string; role: string; plan: string }> = {},
): string {
  const token = jwt.sign(
    {
      userId: overrides.userId ?? 42,
      linuxUser: overrides.linuxUser ?? "tester",
      role: overrides.role ?? "user",
      plan: overrides.plan ?? "free",
    },
    TEST_JWT_SECRET,
    { expiresIn: "1h" },
  );
  return `Bearer ${token}`;
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(chatRoutes, {
    env: {
      MYCC_AGENT_RUNTIME: "e2b-claude-agent-sdk",
    },
    ideSessionStore: new InMemoryIdeSessionStore(),
  });
  return app;
}

describe("chat abort route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserById.mockImplementation(makeTestUserLookup());
  });

  it("persists user and assistant message snapshots after a successful chat turn", async () => {
    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: "system",
        session_id: "session-persist",
      };
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "第一段" }],
        },
      };
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "第二段" }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);

    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { authorization: authHeader() },
      payload: {
        message: "请保存这轮对话",
        requestId: "request-persist-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"type":"done"');
    expect(mocks.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        sessionId: "session-persist",
      }),
    );
    expect(mocks.appendConversationMessages).toHaveBeenCalledWith({
      userId: 42,
      sessionId: "session-persist",
      messages: [
        expect.objectContaining({
          role: "user",
          content: "请保存这轮对话",
        }),
        expect.objectContaining({
          role: "assistant",
          content: "第一段第二段",
        }),
      ],
    });

    await app.close();
  });

  it("can load the product-side snapshots persisted by a successful chat turn", async () => {
    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.findUserById.mockResolvedValue(makeTestUser({
      linux_user: "tester",
    }));
    mocks.getConversationMessageSnapshots.mockImplementation(
      async (_userId: number, _sessionId: string, _limit: number) =>
        (mocks.appendConversationMessages.mock.calls[0]?.[0]?.messages || [])
          .map((message: { role: string; content: string; createdAt: Date }) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
          })),
    );
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.runtimeChat.mockImplementation(async function* () {
      yield {
        type: "system",
        session_id: "session-reloadable",
      };
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "可以回看" }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);

    const app = await buildApp();
    const chatResponse = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { authorization: authHeader() },
      payload: {
        message: "这轮稍后要回看",
        requestId: "request-reloadable-1",
      },
    });
    expect(chatResponse.statusCode).toBe(200);
    expect(mocks.appendConversationMessages).toHaveBeenCalledOnce();

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/chat/sessions/session-reloadable/messages",
      headers: { authorization: authHeader() },
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toEqual({
      success: true,
      data: {
        sessionId: "session-reloadable",
        messages: [
          expect.objectContaining({
            type: "user",
            message: expect.objectContaining({
              content: [expect.objectContaining({ text: "这轮稍后要回看" })],
            }),
          }),
          expect.objectContaining({
            type: "assistant",
            message: expect.objectContaining({
              content: [expect.objectContaining({ text: "可以回看" })],
            }),
          }),
        ],
        total: 2,
      },
    });

    await app.close();
  });

  it("pauses the active chat request and ends the stream with user guidance", async () => {
    const runtimeStarted = createDeferred<void>();
    let runtimeParams:
      | { signal?: AbortSignal; requestId?: string }
      | undefined;

    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.runtimeChat.mockImplementation(async function* (params) {
      runtimeParams = params as { signal?: AbortSignal; requestId?: string };
      runtimeStarted.resolve();
      yield {
        type: "system",
        session_id: "session-abort",
      };
      await sleep(30);
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "late reply after pause" }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);

    const app = await buildApp();
    const chatResponsePromise = app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { authorization: authHeader() },
      payload: {
        message: "写一个需要暂停的长任务",
        requestId: "request-stop-1",
      },
    });

    await runtimeStarted.promise;

    const abortResponse = await app.inject({
      method: "POST",
      url: "/api/abort/request-stop-1",
      headers: { authorization: authHeader() },
    });
    const chatResponse = await chatResponsePromise;

    expect(abortResponse.statusCode).toBe(200);
    expect(abortResponse.json()).toEqual({
      success: true,
      type: "aborted",
      active: true,
      message: "已暂停这次任务",
    });
    expect(runtimeParams?.requestId).toBe("request-stop-1");
    expect(runtimeParams?.signal?.aborted).toBe(true);
    expect(chatResponse.body).toContain('"type":"aborted"');
    expect(chatResponse.body).toContain("已暂停这次任务");
    expect(chatResponse.body).toContain("补充说明后继续");
    expect(chatResponse.body).not.toContain("late reply after pause");

    await app.close();
  });

  it("reports whether a conversation request is currently active", async () => {
    const runtimeStarted = createDeferred<void>();
    const releaseRuntime = createDeferred<void>();

    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.runtimeChat.mockImplementation(async function* () {
      runtimeStarted.resolve();
      yield {
        type: "system",
        session_id: "session-active",
      };
      await releaseRuntime.promise;
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);

    const app = await buildApp();
    const chatResponsePromise = app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { authorization: authHeader() },
      payload: {
        message: "检查当前任务是否还在跑",
        requestId: "request-active-1",
        sessionId: "session-active",
      },
    });

    await runtimeStarted.promise;

    const activeResponse = await app.inject({
      method: "GET",
      url: "/api/chat/requests/active?sessionId=session-active",
      headers: { authorization: authHeader() },
    });

    expect(activeResponse.statusCode).toBe(200);
    expect(activeResponse.json()).toEqual({
      success: true,
      data: {
        active: true,
        requests: [
          expect.objectContaining({
            requestId: "request-active-1",
            sessionId: "session-active",
          }),
        ],
      },
    });

    releaseRuntime.resolve();
    await chatResponsePromise;

    const inactiveResponse = await app.inject({
      method: "GET",
      url: "/api/chat/requests/active?sessionId=session-active",
      headers: { authorization: authHeader() },
    });

    expect(inactiveResponse.statusCode).toBe(200);
    expect(inactiveResponse.json()).toEqual({
      success: true,
      data: {
        active: false,
        requests: [],
      },
    });

    await app.close();
  });

  it("keeps active request diagnostics and aborts scoped to the authenticated user", async () => {
    const runtimeStarted = createDeferred<void>();
    const releaseRuntime = createDeferred<void>();
    let runtimeSignal: AbortSignal | undefined;

    mocks.appendConversationMessages.mockResolvedValue(undefined);
    mocks.checkQuota.mockResolvedValue({ allowed: true, remaining: 1000 });
    mocks.createAgentRuntime.mockReturnValue({ chat: mocks.runtimeChat });
    mocks.getConversationMessageSnapshots.mockResolvedValue([]);
    mocks.logUsage.mockResolvedValue(undefined);
    mocks.runtimeChat.mockImplementation(async function* (params) {
      runtimeSignal = (params as { signal?: AbortSignal }).signal;
      runtimeStarted.resolve();
      yield {
        type: "system",
        session_id: "session-private",
      };
      await releaseRuntime.promise;
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
      };
    });
    mocks.updateConversationStats.mockResolvedValue(undefined);
    mocks.upsertConversation.mockResolvedValue(true);
    mocks.userOwnsConversation.mockResolvedValue(true);

    const app = await buildApp();
    const chatResponsePromise = app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { authorization: authHeader() },
      payload: {
        message: "验证当前用户的任务状态",
        requestId: "request-private-1",
        sessionId: "session-private",
      },
    });

    await runtimeStarted.promise;

    const ownerActiveResponse = await app.inject({
      method: "GET",
      url: "/api/chat/requests/active?requestId=request-private-1",
      headers: { authorization: authHeader() },
    });
    expect(ownerActiveResponse.statusCode).toBe(200);
    expect(ownerActiveResponse.json()).toEqual({
      success: true,
      data: {
        active: true,
        requests: [
          expect.objectContaining({
            requestId: "request-private-1",
            sessionId: "session-private",
          }),
        ],
      },
    });

    const otherUserHeader = authHeader({ userId: 43, linuxUser: "other" });
    const otherActiveResponse = await app.inject({
      method: "GET",
      url: "/api/chat/requests/active?sessionId=session-private&requestId=request-private-1",
      headers: { authorization: otherUserHeader },
    });
    expect(otherActiveResponse.statusCode).toBe(200);
    expect(otherActiveResponse.json()).toEqual({
      success: true,
      data: {
        active: false,
        requests: [],
      },
    });

    const otherAbortResponse = await app.inject({
      method: "POST",
      url: "/api/abort/request-private-1",
      headers: { authorization: otherUserHeader },
    });
    expect(otherAbortResponse.statusCode).toBe(200);
    expect(otherAbortResponse.json()).toEqual({
      success: true,
      type: "aborted",
      active: false,
      message: "这次任务已经结束",
    });
    expect(runtimeSignal?.aborted).toBe(false);

    releaseRuntime.resolve();
    await chatResponsePromise;
    await app.close();
  });
});
