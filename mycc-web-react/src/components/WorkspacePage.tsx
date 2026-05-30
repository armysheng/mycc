import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tree, type NodeRendererProps } from "react-arborist";
import Editor from "@monaco-editor/react";
import {
  ArchiveBoxIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  DocumentIcon,
  DocumentTextIcon,
  FilmIcon,
  FolderIcon,
  FolderOpenIcon,
  PhotoIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  getAuthHeaders,
  getIdeConfigUrl,
  getIdeCurrentSessionUrl,
  getIdeSessionsUrl,
  getWorkspaceFileUrl,
  getWorkspaceSaveFileUrl,
  getWorkspaceTreeUrl,
  resolveIdeOpenUrl,
} from "../config/api";

type WorkspaceNodeType = "directory" | "file";

interface WorkspaceTreeNode {
  id: string;
  name: string;
  path: string;
  type: WorkspaceNodeType;
  size: number;
  mtime: string;
  children?: WorkspaceTreeNode[];
}

interface WorkspaceFileData {
  path: string;
  size: number;
  mtime: string;
  truncated: boolean;
  binary: boolean;
  content: string | null;
}

interface IdeConfigData {
  enabled?: boolean;
  provider?: string;
  e2bTemplate?: string;
  codeServerPort?: number;
  sessionTtlSeconds?: number;
}

interface IdeSessionData {
  id?: string;
  provider?: string;
  sandboxId?: string;
  status?: string;
  expiresAt?: string;
  openPath?: string;
}

class ApiRequestError extends Error {
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function requiresRemoteIdeSession(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("E2B 工作区会话不存在")
    || error.message.includes("请先打开 Remote IDE")
    || error.message.includes("请先打开代码编辑器");
}

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "plaintext";
}

function formatTime(value?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TreeIconMeta = {
  Icon: typeof DocumentIcon;
  colorClass: string;
};

function getTreeIconMeta(name: string, isDirectory: boolean, isOpen: boolean): TreeIconMeta {
  if (isDirectory) {
    return {
      Icon: isOpen ? FolderOpenIcon : FolderIcon,
      colorClass: "text-amber-500 dark:text-amber-400",
    };
  }

  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";

  if (
    ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "mjs" ||
    ext === "py" || ext === "go" || ext === "rs" || ext === "java" || ext === "sh" ||
    ext === "bash" || ext === "json" || ext === "yml" || ext === "yaml" || ext === "toml" ||
    ext === "xml" || ext === "sql"
  ) {
    return { Icon: CodeBracketIcon, colorClass: "text-sky-500 dark:text-sky-400" };
  }

  if (
    ext === "md" || ext === "txt" || ext === "rtf" || ext === "doc" || ext === "docx" ||
    lower === "readme" || lower.startsWith("readme.")
  ) {
    return { Icon: DocumentTextIcon, colorClass: "text-indigo-500 dark:text-indigo-400" };
  }

  if (ext === "csv" || ext === "xls" || ext === "xlsx") {
    return { Icon: TableCellsIcon, colorClass: "text-emerald-500 dark:text-emerald-400" };
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp" || ext === "svg") {
    return { Icon: PhotoIcon, colorClass: "text-rose-500 dark:text-rose-400" };
  }

  if (ext === "mp4" || ext === "mov" || ext === "avi" || ext === "mkv" || ext === "mp3" || ext === "wav") {
    return { Icon: FilmIcon, colorClass: "text-fuchsia-500 dark:text-fuchsia-400" };
  }

  if (ext === "zip" || ext === "tar" || ext === "gz" || ext === "tgz" || ext === "7z" || ext === "rar") {
    return { Icon: ArchiveBoxIcon, colorClass: "text-orange-500 dark:text-orange-400" };
  }

  if (
    lower === ".env" || lower.startsWith(".env.") ||
    lower === "package.json" || lower === "tsconfig.json" || lower === "vite.config.ts"
  ) {
    return { Icon: Cog6ToothIcon, colorClass: "text-cyan-500 dark:text-cyan-400" };
  }

  return { Icon: DocumentIcon, colorClass: "text-slate-500 dark:text-slate-400" };
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [treeRoot, setTreeRoot] = useState<WorkspaceTreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [workspaceNeedsIde, setWorkspaceNeedsIde] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<WorkspaceFileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [ideOpening, setIdeOpening] = useState(false);
  const [ideConfig, setIdeConfig] = useState<IdeConfigData | null>(null);
  const [ideSession, setIdeSession] = useState<IdeSessionData | null>(null);
  const [ideConfigLoading, setIdeConfigLoading] = useState(false);
  const [ideConfigError, setIdeConfigError] = useState<string | null>(null);

  const [treeHeight, setTreeHeight] = useState(620);

  const apiFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!token) {
      throw new Error("登录状态失效，请重新登录");
    }
    const res = await fetch(url, {
      ...init,
      headers: getAuthHeaders(token),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      throw new ApiRequestError(json?.error || "请求失败", res.status);
    }
    return json;
  }, [token]);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setError(null);
    try {
      const json = await apiFetch(getWorkspaceTreeUrl("/", 4));
      const tree = json?.data?.tree as WorkspaceTreeNode;
      if (!tree) {
        throw new Error("工作区目录加载失败");
      }
      setTreeRoot(tree);
      if (json?.data?.truncated) {
        setNotice("目录节点较多，已自动截断显示。可分层打开目录查看完整内容。");
      }
      setWorkspaceNeedsIde(false);
    } catch (err) {
      if (requiresRemoteIdeSession(err)) {
        setWorkspaceNeedsIde(true);
        setTreeRoot(null);
        setError(null);
      } else {
        setWorkspaceNeedsIde(false);
        setError(err instanceof Error ? err.message : "加载目录失败");
      }
    } finally {
      setTreeLoading(false);
    }
  }, [apiFetch]);

  const loadCurrentIdeSession = useCallback(async () => {
    try {
      const sessionJson = await apiFetch(getIdeCurrentSessionUrl());
      setIdeSession((sessionJson?.data as IdeSessionData | null | undefined) ?? null);
    } catch {
      setIdeSession(null);
    }
  }, [apiFetch]);

  const loadIdeConfig = useCallback(async () => {
    setIdeConfigLoading(true);
    setIdeConfigError(null);
    try {
      const configJson = await apiFetch(getIdeConfigUrl());
      const config = (configJson?.data as IdeConfigData | undefined) ?? null;
      setIdeConfig(config);
      if (config?.enabled === false) {
        setIdeSession(null);
      } else {
        await loadCurrentIdeSession();
      }
    } catch (err) {
      setIdeConfig(null);
      setIdeSession(null);
      setIdeConfigError(err instanceof Error ? err.message : "代码编辑器状态检查失败");
    } finally {
      setIdeConfigLoading(false);
    }
  }, [apiFetch, loadCurrentIdeSession]);

  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setError(null);
    setNotice(null);
    try {
      const json = await apiFetch(getWorkspaceFileUrl(filePath));
      const file = json?.data as WorkspaceFileData;
      setActiveFile(file);
      setDraftContent(file.content || "");
      setActivePath(file.path);
      if (file.truncated) {
        setNotice("文件超过 1MB，仅加载前 1MB 内容用于在线编辑。");
      }
      if (file.binary) {
        setNotice("该文件是二进制格式，当前版本暂不支持在线编辑。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取文件失败");
    } finally {
      setFileLoading(false);
    }
  }, [apiFetch]);

  const saveCurrentFile = useCallback(async () => {
    if (!activeFile || activeFile.binary) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(getWorkspaceSaveFileUrl(), {
        method: "PUT",
        body: JSON.stringify({
          path: activeFile.path,
          content: draftContent,
        }),
      });
      setActiveFile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          content: draftContent,
          size: new TextEncoder().encode(draftContent).length,
          mtime: new Date().toISOString(),
        };
      });
      setNotice(`已保存 ${activeFile.path}`);
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [activeFile, apiFetch, draftContent, loadTree]);

  const openCodeEditor = useCallback(async () => {
    setIdeOpening(true);
    setError(null);
    setNotice(null);
    const ideWindow = window.open("about:blank", "_blank");
    if (ideWindow) {
      ideWindow.opener = null;
    }
    try {
      const configJson = await apiFetch(getIdeConfigUrl());
      const config = configJson?.data as IdeConfigData | undefined;
      setIdeConfig(config ?? null);
      if (config?.enabled === false) {
        throw new Error("代码编辑器当前未启用");
      }

      const sessionJson = await apiFetch(getIdeSessionsUrl(), { method: "POST" });
      const session = sessionJson?.data as IdeSessionData | undefined;
      if (!session?.openPath) {
        throw new Error("代码编辑器会话创建成功，但缺少打开地址");
      }
      setIdeSession(session);

      const openUrl = resolveIdeOpenUrl(session.openPath);
      if (ideWindow) {
        ideWindow.location.href = openUrl;
      } else {
        window.open(openUrl, "_blank", "noopener,noreferrer");
      }
      setWorkspaceNeedsIde(false);
      setNotice("代码编辑器已在新标签页打开");
      void loadTree();
    } catch (err) {
      ideWindow?.close();
      setError(err instanceof Error ? err.message : "打开代码编辑器失败");
    } finally {
      setIdeOpening(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    void loadIdeConfig();
  }, [loadIdeConfig]);

  useEffect(() => {
    const updateHeight = () => setTreeHeight(Math.max(420, window.innerHeight - 260));
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const dirty = useMemo(() => {
    if (!activeFile || activeFile.binary) return false;
    return (activeFile.content || "") !== draftContent;
  }, [activeFile, draftContent]);

  const onTreeNodeClick = useCallback((node: WorkspaceTreeNode) => {
    setActivePath(node.path);
    if (node.type === "file") {
      void loadFile(node.path);
    }
  }, [loadFile]);

  const renderTreeNode = useCallback(({ node, style }: NodeRendererProps<WorkspaceTreeNode>) => {
    const data = node.data;
    const selected = activePath === data.path;
    const isDir = data.type === "directory";
    const iconMeta = getTreeIconMeta(data.name, isDir, node.isOpen);
    const Icon = iconMeta.Icon;

    return (
      <div
        style={style}
        onClick={() => {
          if (isDir) node.toggle();
          onTreeNodeClick(data);
        }}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer border transition-colors ${
          selected
            ? "bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-200"
            : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        <span className="text-xs w-4 text-center opacity-80">{isDir ? (node.isOpen ? "▾" : "▸") : "·"}</span>
        <span className={`w-4 h-4 ${iconMeta.colorClass}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="truncate">{data.name}</span>
      </div>
    );
  }, [activePath, onTreeNodeClick]);

  const data = treeRoot ? [treeRoot] : [];
  const ideDisabled = ideOpening || ideConfig?.enabled === false;
  const isRunningE2bSession = ideSession?.status === "running" && (
    ideSession.provider === "e2b" || ideConfig?.provider === "e2b"
  );
  const ideStatusLabel = (() => {
    if (ideConfigLoading) return "代码编辑器状态检查中";
    if (ideConfigError) return "代码编辑器状态未知";
    if (ideConfig?.enabled === false) return "代码编辑器未启用";
    if (isRunningE2bSession) return "当前活跃 E2B 工作区已连接";
    if (ideConfig?.provider === "e2b") return "E2B 工作区可创建";
    if (ideConfig?.enabled) return "代码编辑器可打开";
    return "代码编辑器状态待检测";
  })();
  const ideStatusDetail = (() => {
    if (ideConfigError) return ideConfigError;
	    if (ideConfig?.enabled === false) return "后端 MYCC_IDE_PROVIDER 仍为 disabled，不会创建 E2B 工作区。";
	    if (isRunningE2bSession) {
	      const expires = ideSession?.expiresAt ? ` · 到期 ${formatTime(ideSession.expiresAt)}` : "";
	      return `当前用户工作区${expires}`;
	    }
	    if (ideConfig?.provider === "e2b") {
	      return "需要深度编辑代码时会在新标签页打开编辑器。";
	    }
    return "打开后会复用或创建当前用户的代码编辑器会话。";
  })();

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar onNewChat={() => navigate("/")} isOpen={false} onClose={() => {}} />

      <main className="flex-1 overflow-hidden bg-[radial-gradient(1200px_420px_at_80%_-10%,rgba(14,165,233,0.14),transparent),radial-gradient(1000px_420px_at_10%_110%,rgba(16,185,129,0.10),transparent)]">
        <div className="h-full p-5 md:p-6 flex flex-col gap-4">
          <header className="rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/80 backdrop-blur px-5 py-4 flex items-center justify-between gap-4 shadow-sm">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] border border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-700 mb-2">
                Assistant Workbench
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">助理工作间</h1>
              <p className="text-xs text-slate-500 mt-1">给助理接管代码、文件和制品的高级工作台；日常入口仍然是对话。</p>
              <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-1.5 text-xs text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-900/25 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="font-medium">{ideStatusLabel}</span>
                <span className="hidden max-w-[360px] truncate text-emerald-600/80 dark:text-emerald-200/70 md:inline">
                  {ideStatusDetail}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void openCodeEditor();
                }}
                disabled={ideDisabled}
                className="px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
              >
                {ideOpening ? "打开中..." : "打开代码编辑器"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadTree();
                }}
                className="px-3.5 py-2 rounded-xl border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                刷新目录
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveCurrentFile();
                }}
                disabled={!dirty || saving || !activeFile || activeFile.binary}
                className="px-3.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--accent), #0284c7)" }}
              >
                {saving ? "保存中..." : "保存文件"}
              </button>
            </div>
          </header>

          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            <aside className="min-h-0 rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/80 backdrop-blur shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-700/80">
                <div className="text-xs font-medium text-slate-500">文件树</div>
                <div className="text-[11px] text-slate-400 mt-1 truncate">{activePath || "/"}</div>
              </div>

              <div className="flex-1 overflow-auto p-2">
                {treeLoading ? (
                  <div className="text-xs text-slate-500 px-2 py-3">加载目录中...</div>
                ) : workspaceNeedsIde ? (
                  <div className="m-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-100">
                    <div className="font-semibold">E2B 工作区需要代码编辑器</div>
                    <p className="mt-2 text-xs leading-5 text-emerald-700 dark:text-emerald-200/80">
                      当前文件树会复用用户的 E2B 工作区。先创建代码编辑器会话，再回到这里查看同一份 `/home/mycc/workspace`。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void openCodeEditor();
                      }}
                      disabled={ideDisabled}
                      className="mt-3 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100"
                    >
                      创建 E2B 工作区
                    </button>
                  </div>
                ) : (
                  <Tree<WorkspaceTreeNode>
                    data={data}
                    childrenAccessor="children"
                    idAccessor="id"
                    rowHeight={34}
                    width="100%"
                    height={treeHeight}
                    indent={18}
                  >
                    {renderTreeNode}
                  </Tree>
                )}
              </div>
            </aside>

            <section className="min-h-0 rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/90 dark:bg-slate-950/85 shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-700/80 text-xs text-slate-500 flex items-center justify-between gap-3">
                <span className="truncate">{activeFile?.path || "请选择文件"}</span>
                {activeFile && (
                  <span className="shrink-0">{formatSize(activeFile.size)} · {formatTime(activeFile.mtime)}</span>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                {fileLoading ? (
                  <div className="h-full flex items-center justify-center text-sm text-slate-500">读取文件中...</div>
                ) : !activeFile ? (
                  <div className="h-full flex items-center justify-center text-sm text-slate-500">从左侧选择一个文件开始编辑</div>
                ) : activeFile.binary ? (
                  <div className="h-full flex items-center justify-center text-sm text-slate-500">二进制文件暂不支持在线编辑</div>
                ) : (
                  <Editor
                    height="100%"
                    language={detectLanguage(activeFile.path)}
                    value={draftContent}
                    onChange={(value) => setDraftContent(value || "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      wordWrap: "on",
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                    }}
                  />
                )}
              </div>
            </section>
          </div>

          {(error || notice) && (
            <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/85 px-4 py-3 text-sm shadow-sm">
              {error && <div className="text-red-600">系统错误：{error}</div>}
              {notice && <div className="text-emerald-600">{notice}</div>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
