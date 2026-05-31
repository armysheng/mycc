import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowPathIcon,
  ComputerDesktopIcon,
  EyeIcon,
  FolderIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  getAuthHeaders,
  getIdeConfigUrl,
  getIdeDesktopSessionUrl,
  getIdeSessionsUrl,
  getWorkspaceTreeUrl,
  resolveIdeOpenUrl,
} from "../../config/api";

type WorkbenchTab = "browser" | "files" | "preview";
type WorkspaceNodeType = "directory" | "file";

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

type AssistantWorkbenchDockProps = {
  token: string | null;
  onClose: () => void;
};

const LOW_LEVEL_ERROR_PATTERN =
  /E2B|CCR|Agent SDK|code-server|GNU|Remote IDE|sandbox|Claude Code|base url|traffic|tokens?|provider|desktop_pid|websockify/i;

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

export function AssistantWorkbenchDock({
  token,
  onClose,
}: AssistantWorkbenchDockProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("browser");
  const [desktopOpening, setDesktopOpening] = useState(false);
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [treeRoot, setTreeRoot] = useState<WorkspaceTreeNode | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const workspaceNodes = useMemo(
    () => flattenTree(treeRoot).slice(0, 80),
    [treeRoot],
  );

  const openMirroredBrowser = useCallback(async () => {
    setActiveTab("browser");
    setDesktopOpening(true);
    setDesktopError(null);
    try {
      const config = await readApiData<IdeConfigData>(getIdeConfigUrl(), token);
      if (config?.enabled === false || !config?.desktopEnabled) {
        throw new Error("镜像浏览器当前不可用");
      }

      const session = await readApiData<IdeSessionData>(
        getIdeSessionsUrl(),
        token,
        { method: "POST" },
      );
      if (!session?.id) {
        throw new Error("工作台准备失败");
      }

      const desktopSession = await readApiData<IdeSessionData>(
        getIdeDesktopSessionUrl(session.id),
        token,
        { method: "POST" },
      );
      const openPath =
        desktopSession?.desktop?.openPath || desktopSession?.openPath;
      if (!openPath) {
        throw new Error("镜像浏览器启动失败");
      }
      setDesktopUrl(resolveIdeOpenUrl(openPath));
    } catch (error) {
      setDesktopError(safeWorkbenchError(error, "镜像浏览器暂时打不开"));
    } finally {
      setDesktopOpening(false);
    }
  }, [token]);

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

  useEffect(() => {
    if (activeTab === "files" && !filesLoaded && !filesLoading) {
      void loadFiles();
    }
  }, [activeTab, filesLoaded, filesLoading, loadFiles]);

  return (
    <aside
      aria-label="工作台"
      className="fixed inset-y-0 right-0 z-40 flex h-screen w-full max-w-[560px] min-w-0 flex-col border-l panel-surface shadow-2xl xl:static xl:z-auto xl:w-[min(42vw,560px)] xl:min-w-[420px] xl:shrink-0 xl:shadow-none"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)]">
            <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            工作台
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭工作台"
          className="flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="grid flex-1 grid-cols-3 gap-1 rounded-lg border bg-slate-100/70 p-1 dark:bg-slate-900/60">
          <TabButton
            active={activeTab === "browser"}
            icon={
              <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />
            }
            label="镜像浏览器"
            onClick={() => setActiveTab("browser")}
          />
          <TabButton
            active={activeTab === "files"}
            icon={<FolderIcon className="h-4 w-4" aria-hidden="true" />}
            label="文件"
            onClick={() => setActiveTab("files")}
          />
          <TabButton
            active={activeTab === "preview"}
            icon={<EyeIcon className="h-4 w-4" aria-hidden="true" />}
            label="预览"
            onClick={() => setActiveTab("preview")}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === "browser" && (
          <section className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                镜像浏览器
              </span>
              <button
                type="button"
                onClick={() => void openMirroredBrowser()}
                disabled={desktopOpening}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ArrowPathIcon
                  className={`h-3.5 w-3.5 ${desktopOpening ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {desktopOpening
                  ? "启动中..."
                  : desktopUrl
                    ? "重新连接"
                    : "启动镜像浏览器"}
              </button>
            </div>
            {desktopError && (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {desktopError}
              </div>
            )}
            {desktopUrl ? (
              <iframe
                title="镜像浏览器窗口"
                src={desktopUrl}
                className="min-h-0 flex-1 border-0 bg-slate-950"
                allow="clipboard-read; clipboard-write"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-slate-500 dark:text-slate-400">
                点击启动后显示镜像浏览器。
              </div>
            )}
          </section>
        )}

        {activeTab === "files" && (
          <section className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                文件空间
              </span>
              <button
                type="button"
                onClick={() => void loadFiles()}
                disabled={filesLoading}
                aria-label="刷新文件"
                className="flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${filesLoading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </div>
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
                  <div
                    key={node.id || node.path}
                    className="mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  </div>
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
          <section className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500 dark:text-slate-400">
            暂无预览
          </section>
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
      ].join(" ")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
