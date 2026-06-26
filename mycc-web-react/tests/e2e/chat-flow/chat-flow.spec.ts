import { test, expect, type Page, type Route } from "@playwright/test";

const E2E_USER = {
  id: 9001,
  email: "chat-flow@example.test",
  assistant_name: "cc",
  linux_user: "mycc_e2e",
  plan: "free",
  is_initialized: true,
};

type ChatPayload = {
  message?: string;
  sessionId?: string;
  requestId?: string;
  images?: Array<{ data: string; mediaType: string }>;
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function bootstrapAuthenticatedChat(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "e2e-token");
  });

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { success: true, data: E2E_USER }),
  );
  await page.route("**/api/assistant/home", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        assistant: { initialized: true, name: "cc" },
        tasks: [],
        deliverables: [],
        memory: { sources: [] },
        capabilities: [],
      },
    }),
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, { success: true, data: { skills: [] } }),
  );
  await page.route("**/api/chat/sessions**", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        conversations: [],
        messages: [],
        total: 0,
        hasMore: false,
      },
    }),
  );

  await page.goto("/");
  await expect(chatInput(page)).toBeVisible({ timeout: 20_000 });
}

function chatInput(page: Page) {
  return page.getByRole("textbox");
}

test("[CHAT-001] 真实浏览器输入发送后，重试会继承当前会话", async ({ page }) => {
  const chatRequests: ChatPayload[] = [];
  let chatCallCount = 0;

  await page.route("**/api/chat", async (route) => {
    chatCallCount += 1;
    chatRequests.push(route.request().postDataJSON() as ChatPayload);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: chatCallCount === 1 ? "第一次浏览器回复" : "重试浏览器 OK",
              },
            ],
          },
        },
        { type: "done", sessionId: "e2e-chat-session" },
      ]),
    });
  });

  await bootstrapAuthenticatedChat(page);

  await chatInput(page).fill("请验证真实对话流");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("第一次浏览器回复")).toBeVisible();

  await page.getByRole("button", { name: "重新生成这条回复" }).click();
  await expect(page.getByText("重试浏览器 OK")).toBeVisible();

  expect(chatRequests).toHaveLength(2);
  expect(chatRequests[0]).toMatchObject({
    message: "请验证真实对话流",
    workingDirectory: "~/workspace",
    permissionMode: "bypassPermissions",
  });
  expect(chatRequests[1]).toMatchObject({
    message: "请验证真实对话流",
    sessionId: "e2e-chat-session",
    permissionMode: "bypassPermissions",
  });
});

test("[CHAT-006] 内部 API 重试遥测不会显示成处理动态 JSON", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "system",
          subtype: "api_retry",
          attempt: 2,
          delay_ms: 1000,
        },
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "重试后正常回复 OK" }],
          },
        },
        { type: "done", sessionId: "e2e-api-retry-session" },
      ]),
    });
  });

  await bootstrapAuthenticatedChat(page);

  await chatInput(page).fill("触发一次内部重试");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("重试后正常回复 OK")).toBeVisible();
  await expect(page.getByText("api_retry")).toHaveCount(0);
  await expect(page.getByText('"type": "system"')).toHaveCount(0);
  await expect(page.getByText("处理动态")).toHaveCount(0);
});

test("[CHAT-002] 暂停长任务后显示用户可理解的状态，并可继续发送新任务", async ({
  page,
}) => {
  const chatRequests: ChatPayload[] = [];
  let heldChatRoute: Route | null = null;
  let releaseHeldChat: (() => void) | null = null;
  const heldChatReleased = new Promise<void>((resolve) => {
    releaseHeldChat = resolve;
  });

  await page.route("**/api/abort/**", async (route) => {
    await fulfillJson(route, {
      success: true,
      type: "aborted",
      active: true,
      message: "已暂停这次任务",
    });
    releaseHeldChat?.();
  });

  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as ChatPayload;
    chatRequests.push(request);

    if (chatRequests.length === 1) {
      heldChatRoute = route;
      await heldChatReleased;
      await heldChatRoute.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([{ type: "aborted", message: "已暂停这次任务" }]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "暂停后继续 OK" }],
          },
        },
        { type: "done", sessionId: "e2e-after-pause" },
      ]),
    });
  });

  await bootstrapAuthenticatedChat(page);

  await chatInput(page).fill("先做一个长任务");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "暂停这次任务" }).click();

  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await expect(page.getByText(/补充说明后继续|重新尝试/)).toBeVisible();

  await chatInput(page).fill("现在做另一个任务");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("暂停后继续 OK")).toBeVisible();

  expect(chatRequests).toHaveLength(2);
  expect(chatRequests[0]?.message).toBe("先做一个长任务");
  expect(chatRequests[1]?.message).toBe("现在做另一个任务");
});

test("[CHAT-005] 任务运行中可继续输入，后续消息会排队接上", async ({
  page,
}) => {
  const chatRequests: ChatPayload[] = [];
  let releaseFirstResponse: (() => void) | null = null;
  const firstResponseReleased = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });

  await page.route("**/api/chat", async (route) => {
    const request = route.request().postDataJSON() as ChatPayload;
    chatRequests.push(request);

    if (chatRequests.length === 1) {
      await firstResponseReleased;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([{ type: "done", sessionId: "e2e-queue-root" }]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "排队浏览器 OK" }],
          },
        },
        { type: "done", sessionId: "e2e-queue-next" },
      ]),
    });
  });

  await bootstrapAuthenticatedChat(page);

  await chatInput(page).fill("先做一个长任务");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => chatRequests.length).toBe(1);

  await expect(chatInput(page)).toBeEnabled();
  await chatInput(page).fill("长任务结束后继续做这个");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(
    page
      .getByTestId("queued-message-float")
      .getByText("长任务结束后继续做这个"),
  ).toBeVisible();
  await expect(page.getByTestId("queued-message-float")).toContainText(
    "等待接上",
  );
  expect(chatRequests).toHaveLength(1);

  releaseFirstResponse?.();

  await expect(page.getByText("排队浏览器 OK")).toBeVisible();
  expect(chatRequests).toHaveLength(2);
  expect(chatRequests[1]).toMatchObject({
    message: "长任务结束后继续做这个",
    sessionId: "e2e-queue-root",
  });
});

test("[CHAT-003] 图片附件随请求发送，但聊天正文不暴露 base64", async ({ page }) => {
  let chatPayload: ChatPayload | undefined;

  await page.route("**/api/chat", async (route) => {
    chatPayload = route.request().postDataJSON() as ChatPayload;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "图片收到 OK" }],
          },
        },
        { type: "done", sessionId: "e2e-image-session" },
      ]),
    });
  });

  await bootstrapAuthenticatedChat(page);

  await page
    .getByLabel("选择资料")
    .setInputFiles({
      name: "screen.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71]),
    });
  await expect(page.getByText("screen.png")).toBeVisible();

  await chatInput(page).fill("看一下截图");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("图片收到 OK")).toBeVisible();

  expect(chatPayload?.images).toEqual([
    {
      data: "iVBORw==",
      mediaType: "image/png",
    },
  ]);
  await expect(page.getByText(/已添加资料：screen\.png/)).toBeVisible();
  await expect(page.getByText(/iVBORw==/)).toHaveCount(0);
});

test("[CHAT-004] 打开旧会话后可继续，并保持回复关联", async ({ page }) => {
  let chatPayload: ChatPayload | undefined;
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "e2e-token");
  });
  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, { success: true, data: E2E_USER }),
  );
  await page.route("**/api/assistant/home", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        assistant: { initialized: true, name: "cc" },
        tasks: [],
        deliverables: [],
        memory: { sources: [] },
        capabilities: [],
      },
    }),
  );
  await page.route("**/api/skills", (route) =>
    fulfillJson(route, { success: true, data: { skills: [] } }),
  );
  await page.route("**/api/chat/sessions/e2e-old-session/messages", (route) =>
    fulfillJson(route, {
      success: true,
      data: {
        sessionId: "e2e-old-session",
        messages: [
          {
            type: "user",
            timestamp: "2026-06-02T00:00:00.000Z",
            message: {
              role: "user",
              content: [{ type: "text", text: "旧会话里的问题" }],
            },
          },
          {
            type: "assistant",
            timestamp: "2026-06-02T00:00:02.000Z",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "旧会话里的回答" }],
            },
          },
        ],
        total: 2,
      },
    }),
  );
  await page.route("**/api/chat/sessions**", (route) =>
    fulfillJson(route, {
      success: true,
      data: { conversations: [], total: 0, hasMore: false },
    }),
  );
  await page.route("**/api/chat", async (route) => {
    chatPayload = route.request().postDataJSON() as ChatPayload;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "旧会话继续 OK" }],
          },
        },
        { type: "done", sessionId: "e2e-old-session" },
      ]),
    });
  });

  await page.goto("/?sessionId=e2e-old-session");
  await expect(page.getByText("旧会话里的问题")).toBeVisible();
  await expect(page.getByText("旧会话里的回答")).toBeVisible();

  await chatInput(page).fill("继续这个旧会话");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("旧会话继续 OK")).toBeVisible();

  expect(chatPayload).toMatchObject({
    message: "继续这个旧会话",
    sessionId: "e2e-old-session",
  });
});
