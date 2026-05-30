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

function errorJson(status: number, error: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, error }),
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

    fireEvent.click(await screen.findByRole("button", { name: "打开代码编辑器" }));

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(openedWindow.opener).toBeNull();

    config.resolve(okJson({ enabled: true }));
    session.resolve(okJson({ openPath: "/api/ide/sessions/ide_123/open?token=open-token" }));

    await waitFor(() => {
      expect(openedWindow.location.href).toBe(
        `${window.location.origin}/api/ide/sessions/ide_123/open?token=open-token`,
      );
    });
  });

  it("shows the code editor as disabled when the backend provider is off", async () => {
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

    expect(await screen.findByText("代码编辑器未启用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开代码编辑器" })).toBeDisabled();
  });

  it("shows E2B workspace readiness when the backend provider is enabled", async () => {
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

    expect(await screen.findByText("E2B 工作区可创建")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开代码编辑器" })).toBeEnabled();
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
          openPath: "/api/ide/sessions/ide_123/open?token=open-token",
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

	    expect(await screen.findByText("当前活跃 E2B 工作区已连接")).toBeInTheDocument();
	    expect(screen.queryByText(/sbx_123/)).not.toBeInTheDocument();
	  });

  it("shows a code editor CTA when E2B workspace files require a running session", async () => {
    vi.stubGlobal("open", vi.fn());
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/workspace/tree")) {
        return Promise.resolve(errorJson(
          409,
          "E2B 工作区会话不存在，请先打开 Remote IDE",
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

    expect(await screen.findByText("E2B 工作区需要代码编辑器")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 E2B 工作区" })).toBeEnabled();
    expect(screen.queryByText(/系统错误：E2B 工作区会话不存在/)).not.toBeInTheDocument();
  });
});
