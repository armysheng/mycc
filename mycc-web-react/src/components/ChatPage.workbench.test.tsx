import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    user: { assistant_name: "cc", email: "tester@example.com", id: 7 },
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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderChatPage() {
  render(
    <SettingsProvider>
      <MemoryRouter initialEntries={["/projects/demo"]}>
        <Routes>
          <Route path="/projects/*" element={<ChatPage />} />
          <Route path="/workspace" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </SettingsProvider>,
  );
}

describe("ChatPage workbench dock", () => {
  beforeEach(() => {
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
                  "/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify",
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the mirrored browser in the chat right dock through the MyCC proxy", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    expect(screen.getByLabelText("工作台")).not.toHaveClass("hidden");
    fireEvent.click(
      await screen.findByRole("button", { name: "启动镜像浏览器" }),
    );

    const iframe = await screen.findByTitle("镜像浏览器窗口");
    expect(iframe).toHaveAttribute(
      "src",
      `${window.location.origin}/api/ide/sessions/ide_123/desktop/proxy/vnc.html?autoconnect=true&resize=scale&path=api%2Fide%2Fsessions%2Fide_123%2Fdesktop%2Fproxy%2Fwebsockify`,
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
        method: "POST",
      }),
    );
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

  it("opens a previewed file in the full file space", async () => {
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开工作台" }));
    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "预览 report.md" }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "在文件空间打开" }));

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/workspace?path=%2Freport.md",
    );
    expect(
      screen.queryByText(FORBIDDEN_PROVIDER_TERMS),
    ).not.toBeInTheDocument();
  });
});
