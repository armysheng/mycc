import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProjectSelector } from "./components/ProjectSelector";
import { ChatPage } from "./components/ChatPage";
import { SettingsProvider } from "./contexts/SettingsContext";
import { AuthProvider } from "./contexts/AuthContext";

// Mock fetch globally
global.fetch = vi.fn();

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

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
      expect(screen.getByText("我们应该在 mycc-main 中构建什么？")).toBeInTheDocument();
    });
    expect(screen.getAllByPlaceholderText("描述你想完成的事，MyCC 会帮你拆解并执行…")).toHaveLength(1);
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
});
