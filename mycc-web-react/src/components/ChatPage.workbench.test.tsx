import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { SettingsProvider } from "../contexts/SettingsContext";

vi.mock("./layout/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    logout: vi.fn(),
    refreshUser: vi.fn(),
    token: "test-token",
    user: {
      assistant_name: "cc",
      email: "tester@example.com",
      id: 7,
      linux_user: "tester",
    },
  }),
}));

const FORBIDDEN_PROVIDER_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|Remote IDE|sandbox|沙盒|Claude Code|base url|traffic|tokens?|provider/i;

function okJson(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  } as Response;
}

function errorJson(status: number, error: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, error }),
  } as Response;
}

function sseResponse(events: unknown[]) {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function pendingSseResponse(onStart: (controller: ReadableStreamDefaultController<Uint8Array>) => void) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        onStart(controller);
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function SessionSwitchProbe({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      切到第二会话
    </button>
  );
}

function renderChatPage(
  initialEntry = "/projects/demo",
  switchToEntry?: string,
) {
  render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        {switchToEntry ? <SessionSwitchProbe to={switchToEntry} /> : null}
        <Routes>
          <Route path="/projects/*" element={<ChatPage />} />
          <Route
            path="/workspace"
            element={<div data-testid="workspace-route" />}
          />
        </Routes>
      </MemoryRouter>
    </SettingsProvider>,
  );
}

describe("ChatPage workbench dock", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input, init) => {
        const url = String(input);
        if (url === "/api/assistant/home") {
          return Promise.resolve(
            okJson({
              assistant: { initialized: true, name: "cc" },
              tasks: [],
              deliverables: [],
              memory: { sources: [] },
              capabilities: [],
            }),
          );
        }
        if (url === "/api/skills") {
          return Promise.resolve(okJson({ skills: [] }));
        }
        if (
          url.startsWith("/api/chat/sessions/") &&
          url.endsWith("/messages")
        ) {
          return Promise.resolve(okJson({ messages: [] }));
        }
        if (url === "/api/chat" && init?.method === "POST") {
          return Promise.resolve(
            sseResponse([
              { type: "workbench", tab: "browser", source: "agent-browser" },
              { type: "done", sessionId: "session_browser" },
            ]),
          );
        }
        if (url === "/api/ide/config") {
          return Promise.resolve(
            okJson({ enabled: true, desktopEnabled: true }),
          );
        }
        if (url === "/api/ide/sessions" && init?.method === "POST") {
          return Promise.resolve(okJson({ id: "ide_123", status: "running" }));
        }
        if (
          url === "/api/ide/sessions/ide_123/desktop" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            okJson({
              id: "ide_123",
              status: "running",
              desktop: {
                status: "running",
                openPath:
                  "/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify",
              },
            }),
          );
        }
        if (
          url === "/api/ide/sessions/ide_existing/desktop" &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            okJson({
              id: "ide_existing",
              status: "running",
              desktop: {
                status: "running",
                openPath:
                  "/api/ide/sessions/ide_existing/desktop/proxy/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&path=api%2Fide%2Fsessions%2Fide_existing%2Fdesktop%2Fproxy%2Fwebsockify",
              },
            }),
          );
        }
        if (url.startsWith("/api/workspace/tree")) {
          return Promise.resolve(
            okJson({
              tree: {
                id: "/",
                name: "/",
                path: "/",
                type: "directory",
                size: 0,
                mtime: new Date(0).toISOString(),
                children: [
                  {
                    id: "/report.md",
                    name: "report.md",
                    path: "/report.md",
                    type: "file",
                    size: 1200,
                    mtime: new Date(0).toISOString(),
                  },
                ],
              },
            }),
          );
        }
        if (url === "/api/workspace/preview?path=%2Freport.md") {
          return Promise.resolve(
            okJson({
              path: "/report.md",
              size: 1200,
              mtime: new Date(0).toISOString(),
              mimeType: "text/markdown",
              previewType: "markdown",
              truncated: false,
              supported: true,
              content: "# 项目报告\n\n这里是助理整理的重点。",
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the mirrored browser in the chat right dock through the MyCC proxy", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    expect(screen.getByLabelText("工作台")).not.toHaveClass("hidden");
    expect(screen.getByLabelText("工作台").parentElement).toHaveStyle({
      width: "clamp(640px, 52vw, 880px)",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    expect(iframe).toHaveAttribute(
      "src",
      `${window.location.origin}/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify`,
    );

    expect(fetch).toHaveBeenCalledWith("/api/ide/config", {
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/ide/sessions",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/ide/sessions/ide_123/desktop",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("opens the mirrored browser dock when the agent stream uses the sandbox browser helper", async () => {
    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "打开这个链接看看" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/api/ide/sessions/ide_123/desktop/proxy/vnc.html",
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    const chatBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(chatBody).not.toHaveProperty("sessionId");
    expect(fetch).toHaveBeenCalledWith(
      "/api/ide/sessions/ide_123/desktop",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("sends an authenticated pause request and shows pause guidance when it is active", async () => {
    let chatStreamController:
      | ReadableStreamDefaultController<Uint8Array>
      | null = null;

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return Promise.resolve(
          pendingSseResponse((controller) => {
            chatStreamController = controller;
          }),
        );
      }
      if (url.startsWith("/api/abort/") && init?.method === "POST") {
        chatStreamController?.close();
        return Promise.resolve(
          okJson({
            active: true,
            message: "已暂停这次任务",
            type: "aborted",
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "做一个可以暂停的长任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂停这次任务" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/abort\//),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
    });
    expect(await screen.findByText("已暂停")).toBeInTheDocument();
    expect(screen.getByText(/补充说明后继续/)).toBeInTheDocument();
    expect(screen.getByText(/右侧工作区/)).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PROVIDER_TERMS)).not.toBeInTheDocument();
  });

  it("does not pretend a pause succeeded when the active request has already ended", async () => {
    let chatStreamController:
      | ReadableStreamDefaultController<Uint8Array>
      | null = null;

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return Promise.resolve(
          pendingSseResponse((controller) => {
            chatStreamController = controller;
          }),
        );
      }
      if (url.startsWith("/api/abort/") && init?.method === "POST") {
        chatStreamController?.close();
        return Promise.resolve(
          okJson({
            active: false,
            message: "这次任务已经结束",
            type: "aborted",
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "做一个已经结束的任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂停这次任务" }));

    expect(await screen.findByText("已结束")).toBeInTheDocument();
    expect(screen.getByText(/这次任务已经结束/)).toBeInTheDocument();
    expect(screen.queryByText("已暂停")).not.toBeInTheDocument();
  });

  it("can send another task after a confirmed pause", async () => {
    let chatStreamController:
      | ReadableStreamDefaultController<Uint8Array>
      | null = null;
    let chatCallCount = 0;

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          return Promise.resolve(
            pendingSseResponse((controller) => {
              chatStreamController = controller;
            }),
          );
        }
        return Promise.resolve(
          sseResponse([
            {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "新任务 OK" }],
              },
            },
            { type: "done", sessionId: "session_after_pause" },
          ]),
        );
      }
      if (url.startsWith("/api/abort/") && init?.method === "POST") {
        chatStreamController?.close();
        return Promise.resolve(
          okJson({
            active: true,
            message: "已暂停这次任务",
            type: "aborted",
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "先做一个长任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂停这次任务" }));
    expect(await screen.findByText("已暂停")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "现在做另一个任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("新任务 OK")).toBeInTheDocument();
    const chatCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    expect(chatCalls).toHaveLength(2);
  });

  it("retries an assistant reply with the previous user message", async () => {
    let chatCallCount = 0;
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        chatCallCount += 1;
        return Promise.resolve(
          sseResponse([
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "text",
                    text: chatCallCount === 1 ? "第一次回复" : "重试 OK",
                  },
                ],
              },
            },
            { type: "done", sessionId: "session_retry" },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "请验证重试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("第一次回复")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "重新生成这条回复" }),
    );

    expect(await screen.findByText("重试 OK")).toBeInTheDocument();
    const chatCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    expect(chatCalls).toHaveLength(2);
    const firstBody = JSON.parse(String(chatCalls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(chatCalls[1]?.[1]?.body));
    expect(firstBody.message).toBe("请验证重试");
    expect(retryBody.message).toBe("请验证重试");
    expect(retryBody.sessionId).toBe("session_retry");
  });

  it("includes image attachments in the chat request without exposing base64 in the visible message", async () => {
    renderChatPage();

    const image = new File([new Uint8Array([137, 80, 78, 71])], "screen.png", {
      type: "image/png",
    });

    fireEvent.drop(await screen.findByTestId("chat-composer-dropzone"), {
      dataTransfer: {
        files: [image],
        types: ["Files"],
      },
    });
    expect(await screen.findByText("screen.png")).toBeInTheDocument();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "看一下截图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    const chatBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(chatBody.images).toEqual([
      {
        data: "iVBORw==",
        mediaType: "image/png",
      },
    ]);
    expect(screen.getByText(/已添加资料：screen\.png/).textContent).not.toContain(
      "iVBORw",
    );
  });

  it("continues the loaded conversation session after a page reload", async () => {
    renderChatPage("/projects/demo?sessionId=session_reload");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat/sessions/session_reload/messages",
        expect.any(Object),
      );
    });

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "继续访问刚才的页面" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    const chatBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(chatBody.sessionId).toBe("session_reload");
  });

  it("keeps streamed text chunks associated with one assistant reply", async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return Promise.resolve(
          sseResponse([
            {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "关联" }],
              },
            },
            {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "验收 OK 3" }],
              },
            },
            { type: "done", sessionId: "session_stream_chunks" },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "请只回复：关联验收 OK 3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("关联验收 OK 3")).toBeInTheDocument();
    expect(screen.queryByText("关联")).not.toBeInTheDocument();
    expect(screen.queryByText("验收 OK 3")).not.toBeInTheDocument();
  });

  it("sends the default workspace directory when a new chat has no project path", async () => {
    renderChatPage("/projects");

    expect((await screen.findAllByText("默认工作区")).length).toBeGreaterThan(0);
    expect(screen.queryByText("/home/tester/workspace")).not.toBeInTheDocument();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "整理当前工作区" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    const chatBody = JSON.parse(String(chatCall?.[1]?.body));
    expect(chatBody.workingDirectory).toBe("~/workspace");
  });

  it("uses the active loaded conversation when switching between session urls", async () => {
    renderChatPage(
      "/projects/demo?sessionId=session_one",
      "/projects/demo?sessionId=session_two",
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat/sessions/session_one/messages",
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "切到第二会话" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat/sessions/session_two/messages",
        expect.any(Object),
      );
    });

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "继续第二个会话" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const chatCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) => String(input) === "/api/chat" && init?.method === "POST",
      );
    const lastChatCall = chatCalls[chatCalls.length - 1];
    const chatBody = JSON.parse(String(lastChatCall?.[1]?.body));
    expect(chatBody.sessionId).toBe("session_two");
  });

  it("keeps the mirrored browser iframe warm when the dock is closed and reopened", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/api/ide/sessions/ide_123/desktop/proxy/vnc.html",
      ),
    );
    const desktopStartCallsBeforeClose = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input]) => String(input) === "/api/ide/sessions/ide_123/desktop",
      ).length;

    fireEvent.click(screen.getByRole("button", { name: "关闭工作台" }));
    expect(screen.getByLabelText("工作台")).toHaveAttribute(
      "data-open",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "打开工作台" }));

    expect(screen.getByLabelText("工作台")).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(screen.getByTitle("镜像浏览器窗口")).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/api/ide/sessions/ide_123/desktop/proxy/vnc.html",
      ),
    );
    const desktopStartCallsAfterReopen = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input]) => String(input) === "/api/ide/sessions/ide_123/desktop",
      ).length;
    expect(desktopStartCallsAfterReopen).toBe(desktopStartCallsBeforeClose);
  });

  it("restores the mirrored browser from the stored MyCC session id after a page reload", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) =>
      key === "mycc.workbench.desktopSessionId" ? "ide_existing" : null,
    );
    renderChatPage("/projects/demo?sessionId=session_reload");

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(
        "/api/ide/sessions/ide_existing/desktop/proxy/vnc.html",
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/ide/sessions/ide_existing/desktop",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/ide/sessions",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
  });

  it("keeps the mirrored browser service alive after the frame is open", async () => {
    const keepaliveHandlers: Array<() => void> = [];
    vi.spyOn(window, "setInterval").mockImplementation(
      ((handler: TimerHandler, timeout?: number) => {
        if (timeout === 30_000 && typeof handler === "function") {
          keepaliveHandlers.push(handler as () => void);
        }
        return 1;
      }) as unknown as typeof window.setInterval,
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    await screen.findByTitle("镜像浏览器窗口");
    expect(keepaliveHandlers.length).toBeGreaterThan(0);
    const desktopCallsBeforeKeepalive = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input]) => String(input) === "/api/ide/sessions/ide_123/desktop",
      ).length;

    await act(async () => {
      keepaliveHandlers[keepaliveHandlers.length - 1]?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const desktopCallsAfterKeepalive = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input]) => String(input) === "/api/ide/sessions/ide_123/desktop",
      ).length;
    expect(desktopCallsAfterKeepalive).toBeGreaterThan(
      desktopCallsBeforeKeepalive,
    );
  });

  it("keeps the mirrored browser iframe mounted while switching workbench tabs", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    await waitFor(() => {
      expect(iframe).toHaveAttribute("data-vnc-visible", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "文件" }));

    expect(screen.getByTitle("镜像浏览器窗口")).toBe(iframe);
    await waitFor(() => {
      expect(iframe).toHaveAttribute("data-vnc-visible", "false");
    });
  });

  it("lets the mirrored browser frame return to home and focuses it again on agent browser events", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "mycc.workbench.browser", action: "home" },
        }),
      );
    });

    await waitFor(() => {
      expect(iframe).toHaveAttribute("data-vnc-visible", "false");
    });

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "打开这个链接看看" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(iframe).toHaveAttribute("data-vnc-visible", "true");
    });
  });

  it("toggles the right workbench into an app-level fullscreen view", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));

    const dock = screen.getByLabelText("工作台");
    expect(dock).toHaveAttribute("data-fullscreen", "false");

    fireEvent.click(screen.getByRole("button", { name: "全屏工作台" }));
    expect(dock).toHaveAttribute("data-fullscreen", "true");

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(dock).toHaveAttribute("data-fullscreen", "false");
  });

  it("switches the right dock to workspace files without leaving chat", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "文件" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspace/tree?path=%2F&depth=3",
        expect.any(Object),
      );
    });
    expect(await screen.findByText("report.md")).toBeInTheDocument();
    expect(screen.getByText("/report.md")).toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("shows a productized activity workspace for the current conversation", async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return Promise.resolve(
          sseResponse([
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "todo-1",
                    name: "TodoWrite",
                    input: {
                      todos: [
                        {
                          content: "整理右侧进展面板",
                          activeForm: "正在整理右侧进展面板",
                          status: "in_progress",
                        },
                      ],
                    },
                  },
                  {
                    type: "tool_use",
                    id: "write-1",
                    name: "Write",
                    input: {
                      file_path: "/home/mycc/workspace/docs/report.md",
                      content: "# 报告\n\n完成。",
                    },
                  },
                  {
                    type: "text",
                    text: "已整理：[报告](/docs/report.md)",
                  },
                ],
              },
            },
            {
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "write-1",
                    content: "ok",
                  },
                ],
              },
            },
            { type: "done", sessionId: "session_activity" },
          ]),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "整理当前项目状态" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));

    expect(await screen.findByText("任务进展")).toBeInTheDocument();
    expect(screen.getByText("正在整理右侧进展面板")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.getAllByText("报告").length).toBeGreaterThan(0);
    expect(screen.getByText(/刚刚改动/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "审阅 report.md" }));

    expect(await screen.findByText("审阅改动")).toBeInTheDocument();
    expect(screen.getByText("+ # 报告")).toBeInTheDocument();
    expect(screen.getByText("+ 完成。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览改动文件 report.md" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "在文件空间打开 report.md" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("lets users review file changes and preview the changed file from the right dock", async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return Promise.resolve(
          sseResponse([
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "edit-1",
                    name: "Edit",
                    input: {
                      file_path: "/home/mycc/workspace/src/app.ts",
                      old_str: "const title = '旧标题';",
                      new_str: "const title = '新标题';",
                    },
                  },
                ],
              },
            },
            {
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "edit-1",
                    content: "ok",
                  },
                ],
              },
            },
            { type: "done", sessionId: "session_review" },
          ]),
        );
      }
      if (url === "/api/workspace/preview?path=%2Fsrc%2Fapp.ts") {
        return Promise.resolve(
          okJson({
            path: "/src/app.ts",
            size: 80,
            mtime: new Date(0).toISOString(),
            mimeType: "text/typescript",
            previewType: "text",
            truncated: false,
            supported: true,
            content: "const title = '新标题';",
          }),
        );
      }
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(
          okJson({
            tree: {
              id: "/",
              name: "/",
              path: "/",
              type: "directory",
              children: [],
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "更新标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));

    fireEvent.click(await screen.findByRole("button", { name: "审阅 app.ts" }));

    expect(await screen.findByText("审阅改动")).toBeInTheDocument();
    expect(screen.getByText("- const title = '旧标题';")).toBeInTheDocument();
    expect(screen.getByText("+ const title = '新标题';")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览改动文件 app.ts" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspace/preview?path=%2Fsrc%2Fapp.ts",
        expect.any(Object),
      );
    });
    expect(await screen.findByText("/src/app.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "进展" }));
    fireEvent.click(screen.getByRole("button", { name: "审阅 app.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "在文件空间打开 app.ts" }));

    expect(await screen.findByText("文件空间")).toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("previews a selected workspace file inside the dock", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "文件" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "预览 report.md" }),
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspace/preview?path=%2Freport.md",
        expect.any(Object),
      );
    });
    expect(await screen.findByText("/report.md")).toBeInTheDocument();
    expect(screen.getByText(/这里是助理整理的重点/)).toBeInTheDocument();
    expect(screen.queryByText("暂无预览")).not.toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("keeps a previewed file in the right-side file space", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "预览 report.md" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "在文件空间打开" }),
    );

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/projects/demo",
    );
    expect(screen.getByText("文件空间")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览 report.md" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("keeps low-level mirrored browser failures product-facing", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, desktopEnabled: true }));
      }
      if (url === "/api/ide/sessions") {
        return Promise.resolve(errorJson(400, "Bad Request"));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    expect(await screen.findByText("镜像浏览器暂时打不开")).toBeInTheDocument();
    expect(screen.queryByText("Bad Request")).not.toBeInTheDocument();
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });

  it("hides runtime exit status details from mirrored browser failures", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/assistant/home") {
        return Promise.resolve(
          okJson({
            assistant: { initialized: true, name: "cc" },
            tasks: [],
            deliverables: [],
            memory: { sources: [] },
            capabilities: [],
          }),
        );
      }
      if (url === "/api/skills") {
        return Promise.resolve(okJson({ skills: [] }));
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, desktopEnabled: true }));
      }
      if (url === "/api/ide/sessions") {
        return Promise.resolve(errorJson(400, "exit status 1"));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    expect(await screen.findByText("镜像浏览器暂时打不开")).toBeInTheDocument();
    expect(screen.queryByText("exit status 1")).not.toBeInTheDocument();
  });
});
