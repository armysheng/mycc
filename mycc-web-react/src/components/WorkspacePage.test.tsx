import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";

vi.mock("./layout/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    logout: vi.fn(),
    refreshUser: vi.fn(),
    token: "test-token",
    user: { email: "tester@example.com", id: 42, linux_user: "tester" },
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  default: () => <textarea aria-label="mock editor" readOnly />,
}));

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|Remote IDE|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function okJson(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  };
}

function errorJson(status: number, error: string, code?: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, error, ...(code ? { code } : {}) }),
  };
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens a placeholder tab synchronously before resolving the code editor session", async () => {
    const config = createDeferred<ReturnType<typeof okJson>>();
    const session = createDeferred<ReturnType<typeof okJson>>();
    const openedWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
      opener: window,
    };
    const open = vi.fn().mockReturnValue(openedWindow);
    vi.stubGlobal("open", open);

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return config.promise as Promise<Response>;
      }
      if (url === "/api/ide/sessions") {
        return session.promise as Promise<Response>;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "打开工作间" }));

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(openedWindow.opener).toBeNull();

    config.resolve(okJson({ enabled: true }));
    session.resolve(okJson({ openPath: "/api/ide/sessions/ide_123/proxy/" }));

    await waitFor(() => {
      expect(openedWindow.location.href).toBe(
        `${window.location.origin}/api/ide/sessions/ide_123/proxy/`,
      );
    });
  });

  it("opens the desktop workbench through the MyCC proxy without exposing provider details", async () => {
    const config = createDeferred<ReturnType<typeof okJson>>();
    const session = createDeferred<ReturnType<typeof okJson>>();
    const desktop = createDeferred<ReturnType<typeof okJson>>();
    const openedWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
      opener: window,
    };
    const open = vi.fn().mockReturnValue(openedWindow);
    vi.stubGlobal("open", open);

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return config.promise as Promise<Response>;
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      if (url === "/api/ide/sessions") {
        return session.promise as Promise<Response>;
      }
      if (url === "/api/ide/sessions/ide_123/desktop") {
        return desktop.promise as Promise<Response>;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "打开桌面工作间" }));

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(openedWindow.opener).toBeNull();

    config.resolve(okJson({ enabled: true, provider: "e2b", desktopEnabled: true }));
    session.resolve(okJson({ id: "ide_123", provider: "e2b", status: "running" }));
    desktop.resolve(okJson({
      id: "ide_123",
      provider: "e2b",
      status: "running",
      desktop: {
        status: "running",
        openPath: "/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify",
      },
    }));

    await waitFor(() => {
      expect(openedWindow.location.href).toBe(
        `${window.location.origin}/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify`,
      );
    });
    expect(screen.queryByText(/16080-sbx/)).not.toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("shows the workbench as disabled when the backend provider is off", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: false, provider: "disabled" }) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("工作间未启用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开工作间" })).toBeDisabled();
  });

  it("shows workspace readiness without provider jargon when the backend provider is enabled", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("文件空间可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开工作间" })).toBeEnabled();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("uses workbench copy instead of editor-view jargon on the workspace surface", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("文件空间可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开工作间" })).toBeEnabled();
    expect(screen.queryByText(/编辑视图/)).not.toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("shows the current running E2B IDE session without creating a new one", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        expect(init?.method).toBeUndefined();
        return Promise.resolve(okJson({
          id: "ide_123",
          provider: "e2b",
          sandboxId: "sbx_123",
          status: "running",
          openPath: "/api/ide/sessions/ide_123/proxy/",
        }) as Response);
      }
      if (url === "/api/ide/sessions") {
        return Promise.reject(new Error("Current session status must not create a sandbox"));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
	    );

    expect(await screen.findByText("文件空间已连接")).toBeInTheDocument();
    expect(screen.queryByText(/sbx_123/)).not.toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("opens an initial workspace file from the path query parameter", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/workspace/file?path=%2Fdocs%2Fresearch-report.md") {
        return Promise.resolve(okJson({
          path: "/docs/research-report.md",
          size: 2048,
          mtime: "2026-05-30T10:00:00.000Z",
          truncated: false,
          binary: false,
          content: "# Claude UI 调研报告",
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter initialEntries={["/workspace?path=/docs/research-report.md"]}>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("/docs/research-report.md")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/file?path=%2Fdocs%2Fresearch-report.md",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("surfaces derived deliverables from workspace files and opens them in the editor", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [
              {
                id: "/docs",
                mtime: new Date(0).toISOString(),
                name: "docs",
                path: "/docs",
                size: 0,
                type: "directory",
                children: [
                  {
                    id: "/docs/claude-ui-research.md",
                    mtime: "2026-05-30T10:00:00.000Z",
                    name: "claude-ui-research.md",
                    path: "/docs/claude-ui-research.md",
                    size: 4096,
                    type: "file",
                  },
                ],
              },
              {
                id: "/reports",
                mtime: new Date(0).toISOString(),
                name: "reports",
                path: "/reports",
                size: 0,
                type: "directory",
                children: [
                  {
                    id: "/reports/app.patch",
                    mtime: "2026-05-30T11:00:00.000Z",
                    name: "app.patch",
                    path: "/reports/app.patch",
                    size: 1000,
                    type: "file",
                  },
                ],
              },
              {
                id: "/src",
                mtime: new Date(0).toISOString(),
                name: "src",
                path: "/src",
                size: 0,
                type: "directory",
                children: [
                  {
                    id: "/src/App.tsx",
                    mtime: "2026-05-30T09:00:00.000Z",
                    name: "App.tsx",
                    path: "/src/App.tsx",
                    size: 1024,
                    type: "file",
                  },
                ],
              },
            ],
          },
        }) as Response);
      }
      if (url === "/api/workspace/file?path=%2Fdocs%2Fclaude-ui-research.md") {
        return Promise.resolve(okJson({
          path: "/docs/claude-ui-research.md",
          size: 4096,
          mtime: "2026-05-30T10:00:00.000Z",
          truncated: false,
          binary: false,
          content: "# Claude UI Research",
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("最近成果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开 claude-ui-research.md" })).toBeInTheDocument();
    expect(screen.getByText("变更说明")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 claude-ui-research.md" }));

    expect((await screen.findAllByText("/docs/claude-ui-research.md")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/file?path=%2Fdocs%2Fclaude-ui-research.md",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("uses assistant deliverables as the workbench source and opens their workspace path", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/assistant/deliverables") {
        return Promise.resolve(okJson({
          deliverables: [
            {
              id: "workspace:/reports/product-roadmap.md",
              kind: "report",
              title: "产品路线报告",
              source: "current_workspace",
              status: "ready",
              description: "8 KB · 来自当前工作区",
              path: "/reports/product-roadmap.md",
              updatedAt: "2026-05-31T08:00:00.000Z",
            },
          ],
        }) as Response);
      }
      if (url === "/api/workspace/file?path=%2Freports%2Fproduct-roadmap.md") {
        return Promise.resolve(okJson({
          path: "/reports/product-roadmap.md",
          size: 8192,
          mtime: "2026-05-31T08:00:00.000Z",
          truncated: false,
          binary: false,
          content: "# 产品路线报告",
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("产品路线报告")).toBeInTheDocument();
    expect(screen.getByText("8 KB · 来自当前文件空间")).toBeInTheDocument();
    expect(screen.queryByText("product-roadmap.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开 产品路线报告" }));

    expect((await screen.findAllByText("/reports/product-roadmap.md")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/file?path=%2Freports%2Fproduct-roadmap.md",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("previews an assistant deliverable through the workspace preview API without exposing provider details", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/assistant/deliverables") {
        return Promise.resolve(okJson({
          deliverables: [
            {
              id: "workspace:/reports/product-roadmap.md",
              kind: "report",
              title: "产品路线报告",
              source: "current_workspace",
              status: "ready",
              description: "8 KB · 来自当前工作区",
              path: "/reports/product-roadmap.md",
              updatedAt: "2026-05-31T08:00:00.000Z",
            },
          ],
        }) as Response);
      }
      if (url === "/api/workspace/preview?path=%2Freports%2Fproduct-roadmap.md") {
        return Promise.resolve(okJson({
          path: "/reports/product-roadmap.md",
          size: 8192,
          mtime: "2026-05-31T08:00:00.000Z",
          mimeType: "text/markdown",
          previewType: "markdown",
          truncated: false,
          supported: true,
          content: "# 产品路线报告\n\n下季度重点是提升成果空间体验。",
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("产品路线报告")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览 产品路线报告" }));

    expect(await screen.findByText(/下季度重点是提升成果空间体验/)).toBeInTheDocument();
    expect(screen.getByText("成果预览")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspace/preview?path=%2Freports%2Fproduct-roadmap.md",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("keeps editor capability user-facing without exposing provider or token details", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(okJson({
          tree: {
            id: "/",
            mtime: new Date(0).toISOString(),
            name: "/",
            path: "/",
            size: 0,
            type: "directory",
            children: [],
          },
        }) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson({
          id: "ide_123",
          provider: "e2b",
          sandboxId: "sbx_secret_123",
          status: "running",
          openPath: "/api/ide/sessions/ide_123/proxy/",
        }) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("需要时使用")).toBeInTheDocument();
    expect(screen.getByText("工作间")).toBeInTheDocument();
    expect(screen.getByText("可使用")).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
    expect(screen.queryByText(/sbx_secret_123/)).not.toBeInTheDocument();
    expect(screen.queryByText(/proxy-token-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token=/)).not.toBeInTheDocument();
  });

  it("shows a code editor CTA when workspace files require a running session", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(errorJson(
          409,
          "Workspace session missing",
          "needs_workspace",
        ) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("需要先打开工作间")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开工作间" })).toBeEnabled();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
    expect(screen.queryByText(/系统错误|Workspace session missing|E2B 工作区会话不存在/)).not.toBeInTheDocument();
  });

  it("keeps low-level backend errors out of the user-facing workspace", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(errorJson(
          500,
          'GNU desktop sandbox failed: column "desktop_pid" does not exist',
        ) as Response);
      }
      if (url === "/api/ide/config") {
        return Promise.resolve(okJson({ enabled: true, provider: "e2b" }) as Response);
      }
      if (url === "/api/ide/sessions/current") {
        return Promise.resolve(okJson(null) as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("工作区暂不可用，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/GNU|sandbox|沙盒|desktop_pid|column|does not exist|系统错误/)).not.toBeInTheDocument();
  });
});
