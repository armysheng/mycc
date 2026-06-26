import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
  EyeIcon,
  FolderIcon,
  LockClosedIcon,
  QueueListIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { AllMessage } from "../../types";
import {
  getAuthHeaders,
  getIdeConfigUrl,
  getIdeDesktopSessionUrl,
  getIdeSessionsUrl,
  getWorkspacePreviewUrl,
  getWorkspaceTreeUrl,
  resolveIdeOpenUrl,
} from "../../config/api";
import {
  buildWorkbenchActivitySnapshot,
  type WorkbenchActivityFileChange,
  type WorkbenchActivitySnapshot,
  type WorkbenchActivityStatus,
  type WorkbenchFileChangeKind,
  type WorkbenchTodoStatus,
} from "../../utils/workbenchActivity";

export type WorkbenchTab = "activity" | "browser" | "files" | "preview";
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
  messages?: AllMessage[];
  onClose: () => void;
  onOpenWorkspaceFile?: (path: string) => void;
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

function flattenTree(node: WorkspaceTreeNode | null): WorkspaceTreeNode[] {
  if (!node) return [];
  const children = node.children ?? [];
  return children.flatMap((child) => [child, ...flattenTree(child)]);
}

function formatFileMeta(node: WorkspaceTreeNode): string {
  if (node.type === "directory") return "文件夹";
  if (typeof node.size !== "number") return "文件";
  if (node.size < 1024) return `${node.size} B`;
  if (node.size < 1024 * 1024) return `${(node.size / 1024).toFixed(1)} KB`;
  return `${(node.size / 1024 / 1024).toFixed(1)} MB`;
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
  messages = [],
  onClose,
  onOpenWorkspaceFile,
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

  const workspaceNodes = useMemo(
    () => flattenTree(treeRoot).slice(0, 80),
    [treeRoot],
  );
  const activitySnapshot = useMemo(
    () => buildWorkbenchActivitySnapshot(messages),
    [messages],
  );

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
          throw new Error("镜像浏览器当前不可用");
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
            throw new Error("镜像浏览器启动失败");
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
            throw new Error("工作台准备失败");
          }
          sessionId = session.id;
          const started = await openDesktopForSession(sessionId);
          openPath = started.openPath;
        }

        setDesktopSessionId(sessionId);
        storeDesktopSessionId(sessionId);
        setDesktopUrl(resolveIdeOpenUrl(openPath));
      } catch (error) {
        setDesktopError(safeWorkbenchError(error, "镜像浏览器暂时打不开"));
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
          throw new Error("镜像浏览器启动失败");
        }
        const nextUrl = resolveIdeOpenUrl(openPath);
        setDesktopUrl((currentUrl) =>
          currentUrl === nextUrl ? currentUrl : nextUrl,
        );
        setDesktopError(null);
      } catch (error) {
        setDesktopError(safeWorkbenchError(error, "镜像浏览器正在重连"));
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
      const data = await readApiData<{ tree: WorkspaceTreeNode }>(
        getWorkspaceTreeUrl("/", 3),
        token,
      );
      setTreeRoot(data?.tree ?? null);
      setFilesLoaded(true);
    } catch (error) {
      setFilesError(safeWorkbenchError(error, "文件暂时读不出来"));
    } finally {
      setFilesLoading(false);
    }
  }, [token]);

  const previewWorkspacePath = useCallback(
    async (path: string) => {
      setActiveTab("preview");
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const data = await readApiData<WorkspacePreviewData>(
          getWorkspacePreviewUrl(path),
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
    [token],
  );

  const previewFile = useCallback(
    async (node: WorkspaceTreeNode) => {
      if (node.type !== "file") return;
      await previewWorkspacePath(node.path);
    },
    [previewWorkspacePath],
  );

  const openActivityFile = useCallback(
    (path: string) => {
      onOpenWorkspaceFile?.(path);
      setActiveTab("files");
      if (!filesLoaded && !filesLoading) {
        void loadFiles();
      }
    },
    [filesLoaded, filesLoading, loadFiles, onOpenWorkspaceFile],
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
          message.tab === "activity" ||
          message.tab === "files" ||
          message.tab === "preview"
        ) {
          setActiveTab(message.tab);
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
    ? "镜像浏览器启动中"
    : desktopUrl
      ? "显示镜像浏览器"
      : "启动镜像浏览器";
  const isBrowserFrameVisible =
    activeTab === "browser" && browserSurface === "desktop";

  return (
    <aside
      aria-label="工作台"
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
        onOpenActivity={() => setActiveTab("activity")}
        onOpenFiles={() => setActiveTab("files")}
        onOpenPreview={() => setActiveTab("preview")}
        onToggleFullscreen={() => setIsFullscreen((value) => !value)}
        onClose={handleClose}
      />

      <div className="min-h-0 flex-1">
        {activeTab === "activity" && (
          <WorkbenchActivityPanel
            snapshot={activitySnapshot}
            onOpenFile={openActivityFile}
            onPreviewFile={(path) => void previewWorkspacePath(path)}
          />
        )}

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
                title="镜像浏览器窗口"
                src={desktopUrl}
                data-vnc-visible={isBrowserFrameVisible ? "true" : "false"}
                className={[
                  "h-full min-h-0 flex-1 border-0 bg-slate-950",
                  isBrowserFrameVisible ? "block" : "hidden",
                ].join(" ")}
                allow="clipboard-read; clipboard-write"
              />
            ) : (
              <div className="flex-1 bg-slate-950" />
            )}
          </section>
        )}

        {activeTab === "files" && (
          <section className="flex h-full flex-col pt-12">
            <span className="sr-only">文件空间</span>
            {filesError ? (
              <div className="p-4 text-sm text-amber-700 dark:text-amber-200">
                {filesError}
              </div>
            ) : filesLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                正在读取文件...
              </div>
            ) : workspaceNodes.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {workspaceNodes.map((node) => (
                  <button
                    type="button"
                    key={node.id || node.path}
                    onClick={() => void previewFile(node)}
                    disabled={node.type !== "file"}
                    aria-label={
                      node.type === "file"
                        ? `预览 ${node.name}`
                        : `文件夹 ${node.name}`
                    }
                    className="mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:disabled:hover:bg-transparent"
                  >
                    <FolderIcon
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-700 dark:text-slate-200">
                        {node.name}
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-500">
                        {node.path}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {formatFileMeta(node)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                暂无文件
              </div>
            )}
          </section>
        )}

        {activeTab === "preview" && (
          <section className="flex h-full flex-col pt-12">
            <span className="sr-only">预览</span>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  正在生成预览...
                </div>
              ) : previewError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {previewError}
                </div>
              ) : previewData ? (
                <PreviewPane
                  preview={previewData}
                  onOpenWorkspaceFile={onOpenWorkspaceFile}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  从文件列表点选一个文件进行预览。
                </div>
              )}
            </div>
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
  onOpenActivity,
  onOpenFiles,
  onOpenPreview,
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
  onOpenActivity: () => void;
  onOpenFiles: () => void;
  onOpenPreview: () => void;
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
        <IconBadgeButton label="收起镜像画面" onClick={onLockBrowser}>
          <LockClosedIcon className="h-4 w-4" aria-hidden="true" />
        </IconBadgeButton>
      )}
      {canReconnectBrowser && (
        <IconBadgeButton label="重连镜像浏览器" onClick={onReconnectBrowser}>
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
        </IconBadgeButton>
      )}
      <IconBadgeButton
        active={activeTab === "activity"}
        label="进展"
        onClick={onOpenActivity}
      >
        <QueueListIcon className="h-4 w-4" aria-hidden="true" />
      </IconBadgeButton>
      <IconBadgeButton
        active={activeTab === "files"}
        label="文件"
        onClick={onOpenFiles}
      >
        <FolderIcon className="h-4 w-4" aria-hidden="true" />
      </IconBadgeButton>
      <IconBadgeButton
        active={activeTab === "preview"}
        label="预览"
        onClick={onOpenPreview}
      >
        <EyeIcon className="h-4 w-4" aria-hidden="true" />
      </IconBadgeButton>
      <IconBadgeButton
        active={isFullscreen}
        label={isFullscreen ? "退出全屏" : "全屏工作台"}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? (
          <ArrowsPointingInIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowsPointingOutIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </IconBadgeButton>
      <IconBadgeButton label="关闭工作台" onClick={onClose}>
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

function WorkbenchActivityPanel({
  onOpenFile,
  onPreviewFile,
  snapshot,
}: {
  onOpenFile: (path: string) => void;
  onPreviewFile: (path: string) => void;
  snapshot: WorkbenchActivitySnapshot;
}) {
  const [selectedFileChangeId, setSelectedFileChangeId] = useState<
    string | null
  >(null);
  const hasActivity =
    snapshot.todos.length > 0 ||
    snapshot.tools.length > 0 ||
    snapshot.fileChanges.length > 0 ||
    snapshot.deliverables.length > 0;
  const selectedFileChange = useMemo(
    () =>
      snapshot.fileChanges.find((change) => change.id === selectedFileChangeId) ??
      null,
    [selectedFileChangeId, snapshot.fileChanges],
  );

  useEffect(() => {
    if (
      selectedFileChangeId &&
      !snapshot.fileChanges.some((change) => change.id === selectedFileChangeId)
    ) {
      setSelectedFileChangeId(null);
    }
  }, [selectedFileChangeId, snapshot.fileChanges]);

  return (
    <section className="flex h-full flex-col pt-12">
      <div className="border-b border-slate-200 px-4 pb-3 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
          任务进展
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
          MyCC 正在整理的线索
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          这里会把对话里的计划、操作、文件和成果放在一起，方便你接管或复盘。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!hasActivity ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 px-5 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <SparklesIcon className="mx-auto h-7 w-7 text-amber-500" />
              <h3 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                还没有新的进展
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                发起任务后，待办、文件变更和成果会逐步沉淀到这里。
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ActivitySection
              title="待办"
              count={snapshot.todos.length}
              icon={<QueueListIcon className="h-4 w-4" />}
            >
              {snapshot.todos.length === 0 ? (
                <ActivityEmpty>还没有拆出待办。</ActivityEmpty>
              ) : (
                <div className="space-y-1.5">
                  {snapshot.todos.map((todo) => (
                    <div
                      key={todo.id}
                      className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900"
                    >
                      <span
                        className={[
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          getTodoDotClass(todo.status),
                        ].join(" ")}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {todo.text}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {getTodoStatusLabel(todo.status)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ActivitySection>

            <ActivitySection
              title="最近操作"
              count={snapshot.tools.length}
              icon={<WrenchScrewdriverIcon className="h-4 w-4" />}
            >
              {snapshot.tools.length === 0 ? (
                <ActivityEmpty>还没有可展示的操作。</ActivityEmpty>
              ) : (
                <div className="space-y-1.5">
                  {snapshot.tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="rounded-xl border border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={[
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            getStatusDotClass(tool.status),
                          ].join(" ")}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {tool.label}
                          </p>
                          {tool.path && (
                            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                              {tool.path}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                          {getActivityStatusLabel(tool.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ActivitySection>

            <ActivitySection
              title="刚刚改动"
              count={snapshot.fileChanges.length}
              icon={<DocumentTextIcon className="h-4 w-4" />}
            >
              {snapshot.fileChanges.length === 0 ? (
                <ActivityEmpty>还没有识别到文件改动。</ActivityEmpty>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    {snapshot.fileChanges.map((change) => (
                      <button
                        type="button"
                        key={change.id}
                        aria-label={`审阅 ${change.fileName}`}
                        onClick={() => setSelectedFileChangeId(change.id)}
                        className={[
                          "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                          selectedFileChange?.id === change.id
                            ? "border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30"
                            : "border-slate-100 bg-white hover:border-amber-200 hover:bg-amber-50/50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-amber-900 dark:hover:bg-amber-950/20",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {change.fileName}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                              {change.path}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                            {getFileChangeKindLabel(change.kind)}
                          </span>
                        </div>
                        {(change.addedLines || change.removedLines) && (
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            {change.addedLines
                              ? `新增约 ${change.addedLines} 行`
                              : ""}
                            {change.addedLines && change.removedLines
                              ? " · "
                              : ""}
                            {change.removedLines
                              ? `移除约 ${change.removedLines} 行`
                              : ""}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                  {selectedFileChange && (
                    <FileChangeReviewCard
                      change={selectedFileChange}
                      onOpenFile={onOpenFile}
                      onPreviewFile={onPreviewFile}
                    />
                  )}
                </div>
              )}
            </ActivitySection>

            <ActivitySection
              title="成果线索"
              count={snapshot.deliverables.length}
              icon={<SparklesIcon className="h-4 w-4" />}
            >
              {snapshot.deliverables.length === 0 ? (
                <ActivityEmpty>成果文件会在这里出现。</ActivityEmpty>
              ) : (
                <div className="space-y-1.5">
                  {snapshot.deliverables.map((deliverable) => (
                    <div
                      key={deliverable.id}
                      className="rounded-xl border border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="flex items-start gap-2">
                        <DocumentTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {deliverable.title}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                            {deliverable.path}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ActivitySection>
          </div>
        )}
      </div>
    </section>
  );
}

function FileChangeReviewCard({
  change,
  onOpenFile,
  onPreviewFile,
}: {
  change: WorkbenchActivityFileChange;
  onOpenFile: (path: string) => void;
  onPreviewFile: (path: string) => void;
}) {
  const hasDiffs = change.diffs.length > 0;
  const previewLines = change.previewContent
    ? change.previewContent.split("\n")
    : [];

  return (
    <article className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm dark:border-amber-900 dark:bg-slate-950">
      <header className="border-b border-amber-100 bg-amber-50/70 px-3 py-2 dark:border-amber-950 dark:bg-amber-950/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-200">
              审阅改动
            </p>
            <h4 className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {change.fileName}
            </h4>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {change.path}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 shadow-sm dark:bg-slate-900 dark:text-amber-200">
            {getReviewKindLabel(change.reviewKind)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPreviewFile(change.previewPath)}
            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            aria-label={`预览改动文件 ${change.fileName}`}
          >
            预览文件
          </button>
          <button
            type="button"
            onClick={() => onOpenFile(change.previewPath)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            aria-label={`在文件空间打开 ${change.fileName}`}
          >
            在文件空间打开
          </button>
        </div>
      </header>
      <div className="max-h-[360px] overflow-auto bg-slate-950 p-3">
        {hasDiffs ? (
          <div className="space-y-3">
            {change.diffs.map((diff, index) => (
              <ReviewDiffBlock
                // The order is stable within a single tool input.
                key={`${change.id}-${index}`}
                oldText={diff.oldText}
                newText={diff.newText}
              />
            ))}
          </div>
        ) : previewLines.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] py-2">
            {previewLines.map((line, index) => (
              <ReviewLine
                // Content previews can contain duplicate lines.
                key={`${change.id}-preview-${index}`}
                tone="context"
                text={`  ${line || " "}`}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center text-xs text-slate-400">
            这次改动没有可直接展示的内容，可以先打开文件查看。
          </div>
        )}
      </div>
    </article>
  );
}

function ReviewDiffBlock({
  newText,
  oldText,
}: {
  newText: string;
  oldText: string;
}) {
  const removedLines = oldText ? oldText.split("\n") : [];
  const addedLines = newText ? newText.split("\n") : [];

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] py-2">
      {removedLines.map((line, index) => (
        <ReviewLine
          // Diff text can contain duplicate lines; order is the stable identity.
          key={`removed-${index}`}
          tone="removed"
          text={`- ${line || " "}`}
        />
      ))}
      {addedLines.map((line, index) => (
        <ReviewLine
          // Diff text can contain duplicate lines; order is the stable identity.
          key={`added-${index}`}
          tone="added"
          text={`+ ${line || " "}`}
        />
      ))}
    </div>
  );
}

function ReviewLine({
  text,
  tone,
}: {
  text: string;
  tone: "added" | "removed" | "context";
}) {
  return (
    <div
      className={[
        "grid grid-cols-[3rem_1fr] px-2 text-[12px] leading-5",
        tone === "added"
          ? "bg-emerald-400/10 text-emerald-200"
          : tone === "removed"
            ? "bg-red-400/10 text-red-200"
            : "text-slate-300",
      ].join(" ")}
    >
      <span className="select-none pr-3 text-right font-mono text-slate-500" />
      <code className="whitespace-pre font-mono">{text}</code>
    </div>
  );
}

function ActivitySection({
  children,
  count,
  icon,
  title,
}: {
  children: ReactNode;
  count: number;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200">
          <span className="text-amber-500">{icon}</span>
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function ActivityEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      {children}
    </div>
  );
}

function getStatusDotClass(status: WorkbenchActivityStatus): string {
  if (status === "running") return "animate-pulse bg-amber-500";
  if (status === "error") return "bg-red-500";
  return "bg-emerald-500";
}

function getTodoDotClass(status: WorkbenchTodoStatus): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "in_progress") return "animate-pulse bg-amber-500";
  return "bg-slate-300 dark:bg-slate-600";
}

function getTodoStatusLabel(status: WorkbenchTodoStatus): string {
  if (status === "completed") return "已完成";
  if (status === "in_progress") return "进行中";
  return "待处理";
}

function getActivityStatusLabel(status: WorkbenchActivityStatus): string {
  if (status === "running") return "进行中";
  if (status === "error") return "需要处理";
  return "已完成";
}

function getFileChangeKindLabel(kind: WorkbenchFileChangeKind): string {
  if (kind === "created") return "新增";
  if (kind === "updated") return "更新";
  return "变更";
}

function getReviewKindLabel(
  kind: WorkbenchActivityFileChange["reviewKind"],
): string {
  if (kind === "write") return "写入内容";
  if (kind === "edit") return "前后对比";
  return "文件线索";
}

function PreviewPane({
  preview,
  onOpenWorkspaceFile,
}: {
  preview: WorkspacePreviewData;
  onOpenWorkspaceFile?: (path: string) => void;
}) {
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
        <span className="min-w-0 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
          {preview.path}
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
          {onOpenWorkspaceFile && (
            <button
              type="button"
              onClick={() => onOpenWorkspaceFile(preview.path)}
              className="rounded-lg border px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              在文件空间打开
            </button>
          )}
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
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-3 text-xs leading-5 text-slate-100">
          {preview.content || "没有可显示的预览内容。"}
        </pre>
      )}

      {preview.truncated && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          预览内容较长，已显示前半部分。
        </div>
      )}
    </article>
  );
}
