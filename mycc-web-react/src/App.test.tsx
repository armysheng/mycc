import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProjectSelector } from "./components/ProjectSelector";
import { ChatPage } from "./components/ChatPage";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider } from "./contexts/AuthContext";

// Mock fetch globally
global.fetch = vi.fn();

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

function WorkspaceLocationProbe() {
  const location = useLocation();
  return <div data-testid="workspace-location">{location.pathname}{location.search}</div>;
}

describe("App Routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Mock projects API response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    });
  });

  it("renders project selection page at root path", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ProjectSelector />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Select a Project")).toBeInTheDocument();
    });
  });

  it("renders chat page when navigating to projects path", async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/projects/test-path"]}>
              <Routes>
                <Route path="/projects/*" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("MyCC").length).toBeGreaterThan(0);
      expect(screen.getAllByText("/test-path").length).toBeGreaterThan(0);
    });
  });

  it("renders root chat home without treating / as a workspace", async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("今天想让 cc 帮你做什么？")).toBeInTheDocument();
    });
    expect(screen.getAllByPlaceholderText("描述你想完成的事，MyCC 会帮你拆解并执行…")).toHaveLength(1);
    expect(screen.queryByText(/mycc-main/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Return to new chat in /")).not.toBeInTheDocument();
    expect(screen.queryByText(/首次初始化|bootstrap|continue|最近会话|继续：/i)).not.toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("shows a product-facing empty state when an old conversation has no readable messages", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          sessionId: "old-session",
          messages: [],
          total: 0,
        },
      }),
    });

    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/?sessionId=old-session"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("旧对话暂无可显示内容")).toBeInTheDocument();
    });
    expect(screen.getByText(/原记录不会被删除/)).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("keeps a failed old conversation recoverable with a fresh input", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/chat") {
        return Promise.resolve({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({
          success: false,
          error: "Failed to load messages",
        }),
      });
    });

    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/?sessionId=old-session"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("旧对话暂时没读出来")).toBeInTheDocument();
    });
    expect(screen.getByText(/原记录不会被删除/)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/输入你的问题/);
    expect(input).toBeInTheDocument();
    expect(screen.queryByText(/500|Internal Server Error|Failed to load messages/i)).not.toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "继续刚才的事" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      const chatCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url]) => String(url) === "/api/chat",
      );
      expect(chatCall).toBeDefined();
      expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({
        message: "继续刚才的事",
      });
      expect(JSON.parse(String(chatCall?.[1]?.body))).not.toHaveProperty("sessionId");
    });
  });

  it("keeps old-conversation loading copy in Chinese", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/?sessionId=old-session"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    expect(screen.getByText("正在读取旧对话...")).toBeInTheDocument();
    expect(screen.queryByText(/Loading conversation history/i)).not.toBeInTheDocument();
  });

  it("sends bypassPermissions as the default chat permission mode", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      json: () => Promise.resolve({ success: true, data: { skills: [] } }),
    });

    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    fireEvent.change(screen.getByPlaceholderText("描述你想完成的事，MyCC 会帮你拆解并执行…"), {
      target: { value: "帮我检查项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      const chatCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url]) => String(url) === "/api/chat",
      );
      expect(chatCall).toBeDefined();
      expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({
        message: "帮我检查项目",
        permissionMode: "bypassPermissions",
      });
    });
  });

  it("opens assistant deliverables through safe workspace URLs from the home surface", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key) => (
      key === "token" ? "test-token" : null
    ));
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 42,
              email: "tester@example.com",
              assistant_name: "小麦",
              linux_user: "tester",
              plan: "free",
              is_initialized: true,
            },
          }),
        });
      }
      if (url.endsWith("/api/assistant/home")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              assistant: { name: "小麦", initialized: true },
              tasks: [],
              deliverables: [
                {
                  id: "workspace:/reports/product-roadmap.md",
                  kind: "report",
                  title: "产品路线报告",
                  source: "current_workspace",
                  status: "ready",
                  url: "/workspace?path=%2Freports%2Fproduct-roadmap.md&source=home",
                },
              ],
              memory: { sources: [] },
              capabilities: [],
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { skills: [] } }),
      });
    });

    await act(async () => {
      render(
        <AuthProvider>
          <SettingsProvider>
            <MemoryRouter initialEntries={["/"]}>
              <Routes>
                <Route path="/" element={<ChatPage />} />
                <Route path="/workspace" element={<WorkspaceLocationProbe />} />
              </Routes>
            </MemoryRouter>
          </SettingsProvider>
        </AuthProvider>,
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "打开成果" }));

    expect(await screen.findByTestId("workspace-location")).toHaveTextContent(
      "/workspace?path=%2Freports%2Fproduct-roadmap.md&source=home",
    );
  });
});
