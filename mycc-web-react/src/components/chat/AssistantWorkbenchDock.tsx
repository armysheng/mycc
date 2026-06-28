import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Tree, type NodeRendererProps } from "react-arborist";
import Editor from "@monaco-editor/react";
import { getClassWithColor } from "file-icons-js";
import "file-icons-js/css/style.css";
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  FolderIcon,
  FolderOpenIcon,
  LockClosedIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  getAuthHeaders,
  getIdeConfigUrl,
  getIdeDesktopSessionUrl,
  getIdeSessionsUrl,
  getWorkspacePreviewUrl,
  getWorkspaceTreeUrl,
  resolveIdeOpenUrl,
} from "../../config/api";
import { PRODUCT_COPY } from "../../utils/productCopy";

export type WorkbenchTab = "browser" | "files";
type BrowserSurfaceState = "desktop" | "home";
type WorkspaceNodeType = "directory" | "file";
const DESKTOP_KEEPALIVE_INTERVAL_MS = 30_000;
const DESKTOP_SESSION_STORAGE_KEY = "mycc.workbench.desktopSessionId";

interface WorkspaceTreeNode {
  id: string;
  name: string;
  path: string;
  type: WorkspaceNodeType;
  size?: number;
  mtime?: string;
  children?: WorkspaceTreeNode[];
}

interface IdeConfigData {
  enabled?: boolean;
  desktopEnabled?: boolean;
}

interface IdeSessionData {
  id?: string;
  status?: string;
  openPath?: string;
  desktop?: {
    status?: string;
    openPath?: string;
  };
}

interface WorkspacePreviewData {
  path: string;
  size: number;
  mtime: string;
  mimeType: string;
  previewType: "image" | "html" | "markdown" | "text" | "pdf" | "unsupported";
  truncated: boolean;
  supported: boolean;
  content?: string;
  dataUrl?: string;
  reason?: string;
}

type AssistantWorkbenchDockProps = {
  token: string | null;
  isOpen?: boolean;
  initialTab?: WorkbenchTab;
  tabRequestId?: number;
  autoOpenBrowserRequestId?: number;
  onClose: () => void;
};

const LOW_LEVEL_ERROR_PATTERN =
  /E2B|CCR|Agent SDK|code-server|GNU|Remote IDE|sandbox|Claude Code|base url|traffic|tokens?|provider|desktop_pid|websockify|Bad Request|Internal Server Error|request failed|exit status \d+/i;

async function readApiData<T>(
  url: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: getAuthHeaders(token),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `request failed: ${response.status}`);
  }
  return json?.data as T;
}

function safeWorkbenchError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (!message || LOW_LEVEL_ERROR_PATTERN.test(message)) {
    return fallback;
  }
  return message;
}

function formatFileMeta(node: WorkspaceTreeNode): string {
  if (node.type === "directory") return "文件夹";
  if (typeof node.size !== "number") return "文件";
  if (node.size < 1024) return `${node.size} B`;
  if (node.size < 1024 * 1024) return `${(node.size / 1024).toFixed(1)} KB`;
  return `${(node.size / 1024 / 1024).toFixed(1)} MB`;
}

function detectPreviewLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs"))
    return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (
    lower.endsWith(".sh") ||
    lower.endsWith(".bash") ||
    lower.endsWith(".zsh")
  )
    return "shell";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".sql")) return "sql";
  return "plaintext";
}

function getFileIconClass(name: string): string {
  return getClassWithColor(name) || "text-icon medium-blue";
}

function readStoredDesktopSessionId(): string | null {
  try {
    return window.localStorage.getItem(DESKTOP_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeDesktopSessionId(sessionId: string): void {
  try {
    window.localStorage.setItem(DESKTOP_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function forgetStoredDesktopSessionId(): void {
  try {
    window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

export function AssistantWorkbenchDock({
  token,
  isOpen = true,
  initialTab = "browser",
  tabRequestId = 0,
  autoOpenBrowserRequestId = 0,
  onClose,
}: AssistantWorkbenchDockProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(initialTab);
  const [browserSurface, setBrowserSurface] =
    useState<BrowserSurfaceState>("home");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [desktopOpening, setDesktopOpening] = useState(false);
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [desktopSessionId, setDesktopSessionId] = useState<string | null>(null);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [treeRoot, setTreeRoot] = useState<WorkspaceTreeNode | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<WorkspacePreviewData | null>(
    null,
  );
  const browserFrameRef = useRef<HTMLIFrameElement | null>(null);
  const desktopKeepaliveInFlightRef = useRef(false);

  const workspaceTreeData = useMemo(() => treeRoot?.children ?? [], [treeRoot]);
  const ensureWorkspaceSessionId = useCallback(async () => {
    if (desktopSessionId) return desktopSessionId;

    const session = await readApiData<IdeSessionData>(
      getIdeSessionsUrl(),
      token,
      { method: "POST", body: "{}" },
    );
    if (!session?.id) {
      throw new Error(`${PRODUCT_COPY.projectFiles}准备失败`);
    }
    setDesktopSessionId(session.id);
    storeDesktopSessionId(session.id);
    return session.id;
  }, [desktopSessionId, token]);

  const openMirroredBrowser = useCallback(
    async (forceReconnect = false) => {
      setActiveTab("browser");
      setBrowserSurface("desktop");
      if (desktopUrl && !forceReconnect) return;

      setDesktopOpening(true);
      setDesktopError(null);
      if (forceReconnect) setDesktopUrl(null);
      try {
        const config = await readApiData<IdeConfigData>(
          getIdeConfigUrl(),
          token,
        );
        if (config?.enabled === false || !config?.desktopEnabled) {
          throw new Error(`${PRODUCT_COPY.assistantBrowser}当前不可用`);
        }

        const openDesktopForSession = async (sessionId: string) => {
          const desktopSession = await readApiData<IdeSessionData>(
            getIdeDesktopSessionUrl(sessionId),
            token,
            { method: "POST", body: "{}" },
          );
          const openPath =
            desktopSession?.desktop?.openPath || desktopSession?.openPath;
          if (!openPath) {
            throw new Error(`${PRODUCT_COPY.assistantBrowser}启动失败`);
          }
          return { desktopSession, openPath };
        };

        let sessionId = desktopSessionId || readStoredDesktopSessionId();
        let openPath: string | null = null;

        if (sessionId) {
          try {
            const restored = await openDesktopForSession(sessionId);
            openPath = restored.openPath;
          } catch {
            forgetStoredDesktopSessionId();
            sessionId = null;
          }
        }

        if (!sessionId || !openPath) {
          const session = await readApiData<IdeSessionData>(
            getIdeSessionsUrl(),
            token,
            { method: "POST", body: "{}" },
          );
          if (!session?.id) {
            throw new Error(`${PRODUCT_COPY.resultsSpace}准备失败`);
          }
          sessionId = session.id;
          const started = await openDesktopForSession(sessionId);
          openPath = started.openPath;
        }

        setDesktopSessionId(sessionId);
        storeDesktopSessionId(sessionId);
        setDesktopUrl(resolveIdeOpenUrl(openPath));
      } catch (error) {
        setDesktopError(
          safeWorkbenchError(
            error,
            `${PRODUCT_COPY.assistantBrowser}暂时打不开`,
          ),
        );
      } finally {
        setDesktopOpening(false);
      }
    },
    [desktopSessionId, desktopUrl, token],
  );

  const refreshMirroredBrowser = useCallback(
    async (sessionId: string) => {
      if (desktopKeepaliveInFlightRef.current) return;

      desktopKeepaliveInFlightRef.current = true;
      try {
        const desktopSession = await readApiData<IdeSessionData>(
          getIdeDesktopSessionUrl(sessionId),
          token,
          { method: "POST", body: "{}" },
        );
        const openPath =
          desktopSession?.desktop?.openPath || desktopSession?.openPath;
        if (!openPath) {
          throw new Error(`${PRODUCT_COPY.assistantBrowser}启动失败`);
        }
        const nextUrl = resolveIdeOpenUrl(openPath);
        setDesktopUrl((currentUrl) =>
          currentUrl === nextUrl ? currentUrl : nextUrl,
        );
        setDesktopError(null);
      } catch (error) {
        setDesktopError(
          safeWorkbenchError(error, `${PRODUCT_COPY.assistantBrowser}正在重连`),
        );
      } finally {
        desktopKeepaliveInFlightRef.current = false;
      }
    },
    [token],
  );

  const lockMirroredBrowser = useCallback(() => {
    setActiveTab("browser");
    setBrowserSurface("home");
  }, []);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const ideSessionId = await ensureWorkspaceSessionId();
      const data = await readApiData<{ tree: WorkspaceTreeNode }>(
        getWorkspaceTreeUrl("/", 3, ideSessionId),
        token,
      );
      setTreeRoot(data?.tree ?? null);
      setFilesLoaded(true);
    } catch (error) {
      setFilesError(
        safeWorkbenchError(error, `${PRODUCT_COPY.projectFiles}暂时读不出来`),
      );
    } finally {
      setFilesLoading(false);
    }
  }, [ensureWorkspaceSessionId, token]);

  const previewWorkspacePath = useCallback(
    async (path: string) => {
      setActiveTab("files");
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const ideSessionId = await ensureWorkspaceSessionId();
        const data = await readApiData<WorkspacePreviewData>(
          getWorkspacePreviewUrl(path, ideSessionId),
          token,
        );
        setPreviewData(data);
      } catch (error) {
        setPreviewData(null);
        setPreviewError(safeWorkbenchError(error, "预览暂时打不开"));
      } finally {
        setPreviewLoading(false);
      }
    },
    [ensureWorkspaceSessionId, token],
  );

  const previewFile = useCallback(
    async (node: WorkspaceTreeNode) => {
      if (node.type !== "file") return;
      await previewWorkspacePath(node.path);
    },
    [previewWorkspacePath],
  );

  useEffect(() => {
    if (activeTab === "files" && !filesLoaded && !filesLoading) {
      void loadFiles();
    }
  }, [activeTab, filesLoaded, filesLoading, loadFiles]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, tabRequestId]);

  useEffect(() => {
    if (autoOpenBrowserRequestId <= 0) return;
    void openMirroredBrowser();
  }, [autoOpenBrowserRequestId, openMirroredBrowser]);

  useEffect(() => {
    if (!desktopUrl || !desktopSessionId || !token) return;

    const timer = window.setInterval(() => {
      void refreshMirroredBrowser(desktopSessionId);
    }, DESKTOP_KEEPALIVE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [desktopSessionId, desktopUrl, refreshMirroredBrowser, token]);

  useEffect(() => {
    const handleFrameMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const message = data as {
        action?: unknown;
        tab?: unknown;
        type?: unknown;
      };
      if (
        message.type !== "mycc.workbench.browser" &&
        message.type !== "mycc.workbench"
      ) {
        return;
      }

      if (message.type === "mycc.workbench") {
        if (
          message.tab === "browser" ||
          message.tab === "files" ||
          message.tab === "preview"
        ) {
          setActiveTab(message.tab === "preview" ? "files" : message.tab);
        }
      }

      if (message.action === "home" || message.action === "lock") {
        setActiveTab("browser");
        setBrowserSurface("home");
      } else if (message.action === "focus" || message.action === "show") {
        setActiveTab("browser");
        setBrowserSurface("desktop");
      }
    };

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, []);

  useEffect(() => {
    if (!isOpen) setIsFullscreen(false);
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsFullscreen(false);
    onClose();
  }, [onClose]);

  const browserButtonLabel = desktopOpening
    ? `${PRODUCT_COPY.assistantBrowser}启动中`
    : desktopUrl
      ? `显示${PRODUCT_COPY.assistantBrowser}`
      : `启动${PRODUCT_COPY.assistantBrowser}`;
  const isBrowserFrameVisible =
    activeTab === "browser" && browserSurface === "desktop";
  const fileTreeHeight =
    typeof window === "undefined"
      ? 620
      : Math.max(320, Math.min(760, window.innerHeight - 92));
  const renderWorkspaceTreeNode = useCallback(
    ({ node, style }: NodeRendererProps<WorkspaceTreeNode>) => {
      const data = node.data;
      const isDirectory = data.type === "directory";
      const selected = data.type === "file" && previewData?.path === data.path;
      const FileIcon = isDirectory
        ? node.isOpen
          ? FolderOpenIcon
          : FolderIcon
        : null;

      return (
        <button
          type="button"
          style={style}
          onClick={() => {
            if (isDirectory) {
              node.toggle();
              return;
            }
            void previewFile(data);
          }}
          aria-label={isDirectory ? `文件夹 ${data.name}` : `预览 ${data.name}`}
          aria-expanded={isDirectory ? node.isOpen : undefined}
          className={[
            "group flex w-full items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm transition-colors",
            selected
              ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-50"
              : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
          ].join(" ")}
        >
          <span className="w-4 shrink-0 text-center text-[11px] text-slate-400">
            {isDirectory ? (node.isOpen ? "▾" : "▸") : ""}
          </span>
          {FileIcon ? (
            <FileIcon
              className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400"
              aria-hidden="true"
            />
          ) : (
            <i
              className={`${getFileIconClass(data.name)} shrink-0 text-[15px] leading-none`}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">
            {data.name}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatFileMeta(data)}
          </span>
        </button>
      );
    },
    [previewData?.path, previewFile],
  );

  return (
    <aside
      aria-label={PRODUCT_COPY.resultsSpace}
      aria-hidden={!isOpen}
      data-fullscreen={isFullscreen ? "true" : "false"}
      data-open={isOpen ? "true" : "false"}
      className={[
        "fixed inset-y-0 right-0 z-40 flex h-screen w-full min-w-0 flex-col overflow-hidden border-l panel-surface shadow-2xl transition-transform duration-200 ease-out",
        isFullscreen
          ? "inset-0 z-50 w-screen max-w-none border-l-0 lg:fixed lg:inset-0 lg:z-50 lg:h-screen lg:w-screen lg:min-w-0 lg:shadow-2xl"
          : "lg:relative lg:inset-auto lg:z-auto lg:h-full lg:w-full lg:min-w-[420px] lg:shadow-none",
        isOpen
          ? "translate-x-0"
          : "pointer-events-none translate-x-full lg:translate-x-0",
      ].join(" ")}
    >
      <FloatingWorkbenchControls
        activeTab={activeTab}
        browserButtonLabel={browserButtonLabel}
        browserOpening={desktopOpening}
        canLockBrowser={Boolean(desktopUrl) && isBrowserFrameVisible}
        canReconnectBrowser={Boolean(desktopUrl)}
        isFullscreen={isFullscreen}
        onLockBrowser={lockMirroredBrowser}
        onOpenBrowser={() => void openMirroredBrowser()}
        onReconnectBrowser={() => void openMirroredBrowser(true)}
        onOpenFiles={() => setActiveTab("files")}
        onToggleFullscreen={() => setIsFullscreen((value) => !value)}
        onClose={handleClose}
      />

      <div className="min-h-0 flex-1">
        {(activeTab === "browser" || desktopUrl) && (
          <section
            className={[
              "h-full flex-col bg-slate-950",
              activeTab === "browser" ? "flex" : "hidden",
            ].join(" ")}
            aria-hidden={activeTab !== "browser"}
          >
            {desktopError && (
              <div className="absolute left-3 right-44 top-3 z-20 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs text-amber-700 shadow-lg dark:border-amber-900 dark:bg-amber-950/90 dark:text-amber-200">
                {desktopError}
              </div>
            )}
            {desktopUrl ? (
              <iframe
                ref={browserFrameRef}
                title={`${PRODUCT_COPY.assistantBrowser}窗口`}
                src={desktopUrl}
                data-vnc-visible={isBrowserFrameVisible ? "true" : "false"}
                className={[
                  "h-full min-h-0 flex-1 border-0 bg-slate-950",
                  isBrowserFrameVisible ? "block" : "hidden",
                ].join(" ")}
                allow="clipboard-read; clipboard-write"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-slate-950 px-8 text-center text-sm text-slate-300">
                <div className="max-w-sm">
                  <ComputerDesktopIcon
                    className="mx-auto h-10 w-10 text-slate-500"
                    aria-hidden="true"
                  />
                  <h2 className="mt-4 text-base font-semibold text-white">
                    {PRODUCT_COPY.assistantBrowser}
                  </h2>
                  <p className="mt-2 leading-6 text-slate-400">
                    需要查看图形界面、网页或桌面任务时，可以从这里打开
                    {PRODUCT_COPY.brandName}
                    的浏览器。
                  </p>
                  <button
                    type="button"
                    onClick={() => void openMirroredBrowser()}
                    disabled={desktopOpening}
                    className="mt-5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {desktopOpening
                      ? `${PRODUCT_COPY.assistantBrowser}启动中`
                      : `打开${PRODUCT_COPY.assistantBrowser}`}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "files" && (
          <section className="flex h-full flex-col pt-12">
            {filesError ? (
              <div className="p-4 text-sm text-amber-700 dark:text-amber-200">
                {filesError}
              </div>
            ) : filesLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                正在读取文件...
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <header className="border-b border-slate-200 px-4 pb-3 dark:border-slate-800">
                  <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                    {PRODUCT_COPY.projectFiles}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    查看{PRODUCT_COPY.brandName}
                    整理出的文件，也可以快速预览当前选中的内容。
                  </p>
                </header>
                <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                  <div
                    className="min-h-0 flex-1 overflow-hidden border-b border-slate-200 py-2 dark:border-slate-800 lg:w-[42%] lg:flex-none lg:border-b-0 lg:border-r"
                    data-testid="workspace-file-tree"
                  >
                    {workspaceTreeData.length > 0 ? (
                      <Tree<WorkspaceTreeNode>
                        data={workspaceTreeData}
                        childrenAccessor="children"
                        idAccessor="id"
                        rowHeight={34}
                        width="100%"
                        height={fileTreeHeight}
                        indent={18}
                        openByDefault
                      >
                        {renderWorkspaceTreeNode}
                      </Tree>
                    ) : (
                      <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                        暂无文件
                      </div>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    {previewLoading ? (
                      <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                        正在生成预览...
                      </div>
                    ) : previewError ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        {previewError}
                      </div>
                    ) : previewData ? (
                      <PreviewPane preview={previewData} />
                    ) : (
                      <div className="flex h-full min-h-[180px] items-center justify-center px-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        从文件列表点选一个文件进行预览。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function FloatingWorkbenchControls({
  activeTab,
  browserButtonLabel,
  browserOpening,
  canLockBrowser,
  canReconnectBrowser,
  isFullscreen,
  onLockBrowser,
  onOpenBrowser,
  onReconnectBrowser,
  onOpenFiles,
  onToggleFullscreen,
  onClose,
}: {
  activeTab: WorkbenchTab;
  browserButtonLabel: string;
  browserOpening: boolean;
  canLockBrowser: boolean;
  canReconnectBrowser: boolean;
  isFullscreen: boolean;
  onLockBrowser: () => void;
  onOpenBrowser: () => void;
  onReconnectBrowser: () => void;
  onOpenFiles: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/70 p-1 shadow-xl backdrop-blur">
      <IconBadgeButton
        active={activeTab === "browser"}
        label={browserButtonLabel}
        onClick={onOpenBrowser}
        disabled={browserOpening}
      >
        {browserOpening ? (
          <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </IconBadgeButton>
      {canLockBrowser && (
        <IconBadgeButton
          label={`收起${PRODUCT_COPY.assistantBrowser}`}
          onClick={onLockBrowser}
        >
          <LockClosedIcon className="h-4 w-4" aria-hidden="true" />
        </IconBadgeButton>
      )}
      {canReconnectBrowser && (
        <IconBadgeButton
          label={`重连${PRODUCT_COPY.assistantBrowser}`}
          onClick={onReconnectBrowser}
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
        </IconBadgeButton>
      )}
      <IconBadgeButton
        active={activeTab === "files"}
        label={PRODUCT_COPY.projectFiles}
        onClick={onOpenFiles}
      >
        <FolderIcon className="h-4 w-4" aria-hidden="true" />
      </IconBadgeButton>
      <IconBadgeButton
        active={isFullscreen}
        label={isFullscreen ? "退出全屏" : `全屏${PRODUCT_COPY.resultsSpace}`}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? (
          <ArrowsPointingInIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowsPointingOutIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </IconBadgeButton>
      <IconBadgeButton
        label={`关闭${PRODUCT_COPY.resultsSpace}`}
        onClick={onClose}
      >
        <XMarkIcon className="h-4 w-4" aria-hidden="true" />
      </IconBadgeButton>
    </div>
  );
}

function IconBadgeButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={[
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "bg-white text-slate-950 shadow-sm"
          : "text-white/85 hover:bg-white/15 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function PreviewPane({ preview }: { preview: WorkspacePreviewData }) {
  if (!preview.supported || preview.previewType === "unsupported") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-3 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        {preview.reason || "这个文件暂不适合直接预览。"}
      </div>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
          <i
            className={`${getFileIconClass(preview.path)} shrink-0 text-[15px] leading-none`}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{preview.path}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-slate-400">
            {formatFileMeta({
              ...preview,
              id: preview.path,
              name: preview.path,
              type: "file",
            })}
          </span>
        </div>
      </header>

      {preview.previewType === "image" && preview.dataUrl ? (
        <div className="bg-slate-50 p-2 dark:bg-slate-950">
          <img
            src={preview.dataUrl}
            alt={`${preview.path} 预览`}
            className="max-h-[70vh] w-full rounded-xl object-contain"
          />
        </div>
      ) : preview.previewType === "html" ? (
        <iframe
          title={`${preview.path} 预览`}
          sandbox=""
          srcDoc={preview.content || ""}
          className="h-[70vh] w-full bg-white"
        />
      ) : preview.previewType === "pdf" && preview.dataUrl ? (
        <iframe
          title={`${preview.path} 预览`}
          src={preview.dataUrl}
          className="h-[70vh] w-full bg-white"
        />
      ) : (
        <div
          className="h-[70vh] bg-slate-950"
          data-testid="workspace-preview-editor"
        >
          <span className="sr-only">
            {preview.content || "没有可显示的预览内容。"}
          </span>
          <Editor
            height="100%"
            language={detectPreviewLanguage(preview.path)}
            theme="vs-dark"
            value={preview.content || "没有可显示的预览内容。"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              lineNumbersMinChars: 3,
              renderLineHighlight: "none",
            }}
          />
        </div>
      )}

      {preview.truncated && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          预览内容较长，已显示前半部分。
        </div>
      )}
    </article>
  );
}
