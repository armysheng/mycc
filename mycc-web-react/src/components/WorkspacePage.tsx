import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tree, type NodeRendererProps } from "react-arborist";
import Editor from "@monaco-editor/react";
import type { AssistantDeliverableCard } from "../types";
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
  getAssistantDeliverablesUrl,
  getIdeConfigUrl,
  getIdeCurrentSessionUrl,
  getIdeDesktopSessionUrl,
  getIdeSessionsUrl,
  getWorkspaceFileUrl,
  getWorkspacePreviewUrl,
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

interface IdeConfigData {
  enabled?: boolean;
  desktopEnabled?: boolean;
}

interface IdeSessionData {
  id?: string;
  status?: string;
  expiresAt?: string;
  openPath?: string;
  desktop?: {
    status?: string;
    openPath?: string;
  };
}

type WorkspaceDeliverable = {
  id: string;
  title: string;
  path?: string;
  url?: string;
  kind: string;
  description?: string;
  size?: number;
  mtime?: string;
};

class ApiRequestError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    status?: number,
    code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function requiresRemoteIdeSession(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof ApiRequestError) {
    return error.code === "needs_workspace" || error.code === "workspace_stale";
  }
  return error.message.includes("E2B 工作区会话不存在")
    || error.message.includes("请先打开 Remote IDE")
    || error.message.includes("请先打开深度编辑");
}

function safeWorkspaceErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (isLowLevelWorkspaceError(message)) {
    return "工作区暂不可用，请稍后重试。";
  }
  return message
    .replace(/\bClaude Code\b/gi, "工作间")
    .replace(/Claude 工作空间/g, "工作区")
    .replace(/\bbase\s*url\b/gi, "服务地址")
    .replace(/\bRemote IDE\b/gi, "工作间")
    .replace(/\bE2B\b/gi, "文件空间")
    .replace(/\bcode-server\b/gi, "工作间")
    .replace(/\bCCR\b/gi, "模型连接")
    .replace(/\bAgent SDK\b/gi, "助理运行环境")
    .replace(/\bGNU\b/gi, "桌面工作间")
    .replace(/\bsandbox\b/gi, "工作区")
    .replace(/\bsessions?\b/gi, "工作区")
    .replace(/\btokens?\b/gi, "凭据")
    .replace(/会话 ID/g, "打开凭据")
    .replace(/沙盒/g, "工作区");
}

function isLowLevelWorkspaceError(message: string): boolean {
  return /\b(column|relation|table|constraint)\b.+\bdoes not exist\b/i.test(message)
    || /\bSQLSTATE\b|\bsyntax error at or near\b|\bpg_[a-z_]+\b/i.test(message)
    || /\b(token|secret|password)=/i.test(message)
    || /\b(token|secret|password|credential|session|private[-_\s]?key|api[-_\s]?key)\b/i.test(message)
    || /\b[A-Z0-9_]{8,}\b/.test(message);
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

function flattenWorkspaceFiles(node: WorkspaceTreeNode | null): WorkspaceTreeNode[] {
  if (!node) return [];
  if (node.type === "file") return [node];
  return (node.children ?? []).flatMap((child) => flattenWorkspaceFiles(child));
}

function getDeliverableKind(node: WorkspaceTreeNode): string {
  const lower = node.path.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "截图";
  if (/\.(log|txt)$/.test(lower)) return "处理记录";
  if (/\.(html|htm)$/.test(lower) || lower.includes("preview")) return "预览";
  if (lower.includes("diff") || lower.endsWith(".patch")) return "变更说明";
  if (lower.includes("report") || lower.includes("research") || lower.includes("调研") || lower.includes("报告")) {
    return "报告";
  }
  return "文档";
}

function getAssistantDeliverableKindLabel(kind: AssistantDeliverableCard["kind"] | string): string {
  const labels: Record<AssistantDeliverableCard["kind"], string> = {
    document: "文档",
    code_change: "修改记录",
    diff: "变更说明",
    report: "报告",
    link: "链接",
    preview: "预览",
    screenshot: "截图",
    log: "处理记录",
    pr: "协作记录",
    dataset: "数据集",
  };
  return labels[kind as AssistantDeliverableCard["kind"]] ?? "成果";
}

function getAssistantDeliverableSourceLabel(source: AssistantDeliverableCard["source"]): string {
  if (source === "current_workspace") return "来自当前文件空间";
  return "来自当前对话";
}

function getAssistantDeliverableDescription(card: AssistantDeliverableCard): string {
  return (card.description || getAssistantDeliverableSourceLabel(card.source))
    .replace(/当前工作区/g, "当前文件空间");
}

function isLikelyDeliverable(node: WorkspaceTreeNode): boolean {
  if (node.type !== "file") return false;
  const lower = node.path.toLowerCase();
  const deliverablePath = lower.includes("/docs/")
    || lower.includes("/reports/")
    || lower.includes("/output/")
    || lower.includes("/artifacts/")
    || lower.includes("/screenshots/");
  const deliverableName = [
    "report",
    "research",
    "summary",
    "spec",
    "plan",
    "proposal",
    "design",
    "artifact",
    "deliverable",
    "preview",
    "screenshot",
    "log",
    "报告",
    "总结",
    "方案",
    "计划",
    "调研",
    "设计",
    "制品",
  ].some((word) => lower.includes(word));
  const deliverableExtension = /\.(md|pdf|html?|png|jpe?g|webp|svg|log|txt|patch)$/i.test(node.name);

  return deliverableExtension && (deliverablePath || deliverableName);
}

function collectWorkspaceDeliverables(root: WorkspaceTreeNode | null): WorkspaceDeliverable[] {
  return flattenWorkspaceFiles(root)
    .filter(isLikelyDeliverable)
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    .slice(0, 5)
    .map((node) => ({
      id: `tree:${node.path}`,
      path: node.path,
      title: node.name,
      kind: getDeliverableKind(node),
      size: node.size,
      mtime: node.mtime,
      description: `${formatSize(node.size)} · ${formatTime(node.mtime)}`,
    }));
}

function toWorkspaceDeliverable(card: AssistantDeliverableCard): WorkspaceDeliverable | null {
  if (card.status !== "ready") return null;
  if (!card.path && !card.url) return null;

  return {
    id: card.id,
    title: card.title || card.path || card.url || "未命名成果",
    path: card.path,
    url: card.url,
    kind: getAssistantDeliverableKindLabel(card.kind),
    description: getAssistantDeliverableDescription(card),
    mtime: card.updatedAt,
  };
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<WorkspacePreviewData | null>(null);
  const [ideOpening, setIdeOpening] = useState(false);
  const [desktopOpening, setDesktopOpening] = useState(false);
  const [ideConfig, setIdeConfig] = useState<IdeConfigData | null>(null);
  const [ideSession, setIdeSession] = useState<IdeSessionData | null>(null);
  const [ideConfigLoading, setIdeConfigLoading] = useState(false);
  const [ideConfigError, setIdeConfigError] = useState<string | null>(null);
  const [assistantDeliverables, setAssistantDeliverables] = useState<WorkspaceDeliverable[]>([]);

  const [treeHeight, setTreeHeight] = useState(620);
  const initialPathLoadedRef = useRef<string | null>(null);

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
      throw new ApiRequestError(json?.error || "请求失败", res.status, json?.code);
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
        setError(safeWorkspaceErrorMessage(err, "加载目录失败"));
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
      setIdeConfigError(safeWorkspaceErrorMessage(err, "工作间状态检查失败"));
    } finally {
      setIdeConfigLoading(false);
    }
  }, [apiFetch, loadCurrentIdeSession]);

  const loadAssistantDeliverables = useCallback(async () => {
    try {
      const json = await apiFetch(getAssistantDeliverablesUrl());
      const cards = ((json?.data?.deliverables ?? []) as AssistantDeliverableCard[])
        .map(toWorkspaceDeliverable)
        .filter((card): card is WorkspaceDeliverable => Boolean(card))
        .slice(0, 5);
      setAssistantDeliverables(cards);
    } catch {
      setAssistantDeliverables([]);
    }
  }, [apiFetch]);

  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setError(null);
    setNotice(null);
    setPreviewError(null);
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
      setError(safeWorkspaceErrorMessage(err, "读取文件失败"));
    } finally {
      setFileLoading(false);
    }
  }, [apiFetch]);

  const loadPreview = useCallback(async (filePath: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const json = await apiFetch(getWorkspacePreviewUrl(filePath));
      setPreviewData(json?.data as WorkspacePreviewData);
    } catch (err) {
      setPreviewData(null);
      setPreviewError(safeWorkspaceErrorMessage(err, "预览暂不可用"));
    } finally {
      setPreviewLoading(false);
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
      await loadAssistantDeliverables();
    } catch (err) {
      setError(safeWorkspaceErrorMessage(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  }, [activeFile, apiFetch, draftContent, loadAssistantDeliverables, loadTree]);

  const openDeliverable = useCallback((deliverable: WorkspaceDeliverable) => {
    if (deliverable.path) {
      void loadFile(deliverable.path);
      void loadPreview(deliverable.path);
      return;
    }
    if (deliverable.url) {
      window.open(deliverable.url, "_blank", "noopener,noreferrer");
    }
  }, [loadFile, loadPreview]);

  const previewDeliverable = useCallback((deliverable: WorkspaceDeliverable) => {
    if (deliverable.path) {
      void loadPreview(deliverable.path);
      return;
    }
    if (deliverable.url) {
      window.open(deliverable.url, "_blank", "noopener,noreferrer");
    }
  }, [loadPreview]);

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
        throw new Error("工作间当前未启用");
      }

      const sessionJson = await apiFetch(getIdeSessionsUrl(), { method: "POST" });
      const session = sessionJson?.data as IdeSessionData | undefined;
      if (!session?.openPath) {
        throw new Error("工作间准备好了，但缺少打开地址");
      }
      setIdeSession(session);

      const openUrl = resolveIdeOpenUrl(session.openPath);
      if (ideWindow) {
        ideWindow.location.href = openUrl;
      } else {
        window.open(openUrl, "_blank", "noopener,noreferrer");
      }
      setWorkspaceNeedsIde(false);
      setNotice("工作间已在新标签页打开");
      void loadTree();
    } catch (err) {
      ideWindow?.close();
      setError(safeWorkspaceErrorMessage(err, "打开工作间失败"));
    } finally {
      setIdeOpening(false);
    }
  }, [apiFetch]);

  const openDesktop = useCallback(async () => {
    setDesktopOpening(true);
    setError(null);
    setNotice(null);
    const desktopWindow = window.open("about:blank", "_blank");
    if (desktopWindow) {
      desktopWindow.opener = null;
    }
    try {
      const configJson = await apiFetch(getIdeConfigUrl());
      const config = configJson?.data as IdeConfigData | undefined;
      setIdeConfig(config ?? null);
      if (config?.enabled === false) {
        throw new Error("工作区当前未启用");
      }
      if (!config?.desktopEnabled) {
        throw new Error("桌面工作间当前未启用");
      }

      const sessionJson = await apiFetch(getIdeSessionsUrl(), { method: "POST" });
      const session = sessionJson?.data as IdeSessionData | undefined;
      if (!session?.id) {
        throw new Error("工作区准备成功，但缺少打开凭据");
      }

      const desktopJson = await apiFetch(getIdeDesktopSessionUrl(session.id), { method: "POST" });
      const desktopSession = desktopJson?.data as IdeSessionData | undefined;
      const openPath = desktopSession?.desktop?.openPath;
      if (!openPath) {
        throw new Error("桌面工作间启动成功，但缺少打开地址");
      }
      setIdeSession(desktopSession ?? session);

      const openUrl = resolveIdeOpenUrl(openPath);
      if (desktopWindow) {
        desktopWindow.location.href = openUrl;
      } else {
        window.open(openUrl, "_blank", "noopener,noreferrer");
      }
      setWorkspaceNeedsIde(false);
      setNotice("桌面工作间已在新标签页打开");
      void loadTree();
    } catch (err) {
      desktopWindow?.close();
      setError(safeWorkspaceErrorMessage(err, "打开桌面工作间失败"));
    } finally {
      setDesktopOpening(false);
    }
  }, [apiFetch, loadTree]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    void loadIdeConfig();
  }, [loadIdeConfig]);

  useEffect(() => {
    void loadAssistantDeliverables();
  }, [loadAssistantDeliverables]);

  useEffect(() => {
    const initialPath = searchParams.get("path");
    if (!token || !initialPath || initialPathLoadedRef.current === initialPath) return;
    initialPathLoadedRef.current = initialPath;
    void loadFile(initialPath);
  }, [loadFile, searchParams, token]);

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
    if (node.type === "file" && previewData?.path !== node.path) {
      setPreviewData(null);
      setPreviewError(null);
    }
    if (node.type === "file") {
      void loadFile(node.path);
    }
  }, [loadFile, previewData?.path]);

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
  const treeDeliverables = useMemo(() => collectWorkspaceDeliverables(treeRoot), [treeRoot]);
  const deliverables = assistantDeliverables.length > 0 ? assistantDeliverables : treeDeliverables;
  const ideDisabled = ideOpening || ideConfig?.enabled === false;
  const desktopDisabled = desktopOpening || ideConfig?.enabled === false || ideConfig?.desktopEnabled === false;
  const previewDisabled = previewLoading || !activeFile;
  const isRunningWorkspaceSession = ideSession?.status === "running";
  const ideStatusLabel = (() => {
    if (ideConfigLoading) return "文件空间准备中";
    if (ideConfigError) return "文件空间状态未知";
    if (ideConfig?.enabled === false) return "工作间未启用";
    if (isRunningWorkspaceSession) return "文件空间已连接";
    if (ideConfig?.enabled) return "文件空间可用";
    return "文件空间待检测";
  })();
  const ideStatusDetail = (() => {
    if (ideConfigError) return ideConfigError;
    if (ideConfig?.enabled === false) return "当前暂不可用。";
    if (isRunningWorkspaceSession) {
      const expires = ideSession?.expiresAt ? ` · 到期 ${formatTime(ideSession.expiresAt)}` : "";
      return `当前文件空间${expires}`;
    }
    if (ideConfig?.enabled) {
      return "需要细看或大改文件时，会打开工作间。";
    }
    return "打开后会复用或准备你的文件空间。";
  })();
  const codeServerCapabilityLabel = (() => {
    if (ideConfigLoading) return "状态检查中";
    if (ideConfig?.enabled === false) return "未启用";
    if (isRunningWorkspaceSession) return "可使用";
    if (ideConfig?.enabled) return "需要时可打开";
    return "待检测";
  })();
  const previewCapabilityLabel = (() => {
    if (previewLoading) return "生成中";
    if (previewData?.supported) return "已生成";
    if (activePath) return "可预览";
    return "选择成果";
  })();

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar onNewChat={() => navigate("/")} isOpen={false} onClose={() => {}} />

      <main className="flex-1 overflow-hidden bg-[radial-gradient(1200px_420px_at_80%_-10%,rgba(14,165,233,0.14),transparent),radial-gradient(1000px_420px_at_10%_110%,rgba(16,185,129,0.10),transparent)]">
        <div className="h-full p-5 md:p-6 flex flex-col gap-4">
          <header className="rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/80 backdrop-blur px-5 py-4 flex flex-col items-start justify-between gap-4 shadow-sm sm:flex-row sm:items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] border border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-700 mb-2">
                成果空间
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">成果空间</h1>
              <p className="text-xs text-slate-500 mt-1">集中查看助理整理的资料和成果；日常入口仍然是对话。</p>
              <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-1.5 text-xs text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-900/25 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="font-medium">{ideStatusLabel}</span>
                <span className="hidden max-w-[360px] truncate text-emerald-600/80 dark:text-emerald-200/70 md:inline">
                  {ideStatusDetail}
                </span>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  void openCodeEditor();
                }}
                disabled={ideDisabled}
                className="shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
              >
                {ideOpening ? "打开中..." : "打开工作间"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadTree();
                }}
                className="shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                刷新列表
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveCurrentFile();
                }}
                disabled={!dirty || saving || !activeFile || activeFile.binary}
                className="shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--accent), #0284c7)" }}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </header>

          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px] gap-4">
            <aside className="min-h-0 rounded-2xl border border-slate-200/70 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/80 backdrop-blur shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-700/80">
                <div className="text-xs font-medium text-slate-500">资料列表</div>
                <div className="text-[11px] text-slate-400 mt-1 truncate">{activePath || "/"}</div>
              </div>

              <div className="flex-1 overflow-auto p-2">
                {treeLoading ? (
                  <div className="text-xs text-slate-500 px-2 py-3">加载资料中...</div>
                ) : workspaceNeedsIde ? (
                  <div className="m-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-100">
                    <div className="font-semibold">需要先打开工作间</div>
                    <p className="mt-2 text-xs leading-5 text-emerald-700 dark:text-emerald-200/80">
                      当前资料列表会复用你的文件空间。先打开工作间，准备好后这里会显示同一份文件。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void openCodeEditor();
                      }}
                      disabled={ideDisabled}
                      className="mt-3 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100"
                    >
                      立即打开
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
                  <div className="h-full flex items-center justify-center text-sm text-slate-500">选择一份资料查看或修改</div>
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

            <aside className="min-h-0 rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/80 lg:col-span-2 xl:col-span-1 xl:overflow-auto">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                <InspectorPanel
                  title="最近成果"
                  subtitle="这里会汇总助理产出的报告、页面、截图和处理结果。"
                >
                  {deliverables.length > 0 ? (
                    <div className="space-y-2">
                      {deliverables.map((deliverable) => (
                        <article
                          key={deliverable.id}
                          className="group rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-left transition hover:border-sky-200 hover:bg-white dark:border-slate-700/80 dark:bg-slate-800/70 dark:hover:border-sky-700 dark:hover:bg-slate-800"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {deliverable.title}
                              </div>
                              <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {deliverable.description || "来自当前文件空间"}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                              {deliverable.kind}
                            </span>
                          </div>
                          {(deliverable.size || deliverable.mtime) && (
                            <div className="mt-2 text-[11px] text-slate-400">
                              {deliverable.size ? formatSize(deliverable.size) : "成果"} · {formatTime(deliverable.mtime)}
                            </div>
                          )}
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              aria-label={`打开 ${deliverable.title}`}
                              onClick={() => openDeliverable(deliverable)}
                              disabled={!deliverable.path && !deliverable.url}
                              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
                            >
                              打开
                            </button>
                            <button
                              type="button"
                              aria-label={`预览 ${deliverable.title}`}
                              onClick={() => previewDeliverable(deliverable)}
                              disabled={!deliverable.path && !deliverable.url}
                              className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                            >
                              预览
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyInspectorCopy>
                      还没有识别到成果。助理写出的报告、截图、处理记录和预览会优先出现在这里。
                    </EmptyInspectorCopy>
                  )}
                </InspectorPanel>

                <InspectorPanel
                  title="正在查看"
                  subtitle="适合快速查看和少量修改；复杂处理可打开工作间。"
                >
                  {activeFile ? (
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-sm dark:border-slate-700/80 dark:bg-slate-800/70">
                      <div className="font-semibold text-slate-900 dark:text-slate-50">{activeFile.path}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{formatSize(activeFile.size)}</span>
                        <span>{detectLanguage(activeFile.path)}</span>
                        <span className="col-span-2">{formatTime(activeFile.mtime)}</span>
                      </div>
                      {dirty && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                          有未保存修改
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (activeFile?.path) void loadPreview(activeFile.path);
                        }}
                        disabled={previewDisabled}
                        className="mt-3 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
                      >
                        {previewLoading ? "生成预览中..." : "预览当前文件"}
                      </button>
                    </div>
                  ) : (
                    <EmptyInspectorCopy>
                      选择文件或从成果列表打开报告后，这里会显示文件摘要。
                    </EmptyInspectorCopy>
                  )}
                </InspectorPanel>

                <InspectorPanel
                  title="成果预览"
                  subtitle="快速查看报告、页面和截图，不必先进入工作间。"
                >
                  {previewLoading ? (
                    <EmptyInspectorCopy>正在生成预览...</EmptyInspectorCopy>
                  ) : previewError ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-5 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                      {previewError}
                    </div>
                  ) : previewData ? (
                    <PreviewCard preview={previewData} />
                  ) : (
                    <EmptyInspectorCopy>
                      从最近成果点“预览”，或选择文件后预览当前文件。
                    </EmptyInspectorCopy>
                  )}
                </InspectorPanel>

                <InspectorPanel
                  title="需要时使用"
                  subtitle="这些入口按需打开，不占用助理首页。"
                >
                  <div className="space-y-2">
                    <CapabilityRow
                      title="工作间"
                      status={codeServerCapabilityLabel}
                      description="适合大改文件、查看项目结构和处理复杂修改。"
                      actionLabel={ideOpening ? "打开中..." : "打开"}
                      disabled={ideDisabled}
                      onAction={() => {
                        void openCodeEditor();
                      }}
                    />
                    <CapabilityRow
                      title="桌面工作间"
                      status={desktopOpening ? "打开中" : ideConfig?.desktopEnabled ? "可打开" : "未启用"}
                      description="用于需要图形界面的浏览器和桌面任务。"
                      actionLabel={desktopOpening ? "打开中..." : "打开桌面工作间"}
                      disabled={desktopDisabled}
                      onAction={() => {
                        void openDesktop();
                      }}
                    />
                    <CapabilityRow
                      title="预览"
                      status={previewCapabilityLabel}
                      description="快速查看报告、页面和截图成果。"
                      actionLabel={previewLoading ? "生成中..." : "预览当前文件"}
                      disabled={previewDisabled}
                      onAction={() => {
                        if (activeFile?.path) void loadPreview(activeFile.path);
                      }}
                    />
                  </div>
                </InspectorPanel>
              </div>
            </aside>
          </div>

          {(error || notice) && (
            <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/85 px-4 py-3 text-sm shadow-sm">
              {error && <div className="text-red-600">{error}</div>}
              {notice && <div className="text-emerald-600">{notice}</div>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function InspectorPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/80 dark:bg-slate-950/50">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyInspectorCopy({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
      {children}
    </div>
  );
}

function PreviewCard({ preview }: { preview: WorkspacePreviewData }) {
  const previewLabel = preview.truncated ? "预览内容较长，已显示前半部分。" : null;

  if (!preview.supported || preview.previewType === "unsupported") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        {preview.reason || "这个文件暂不适合直接预览。"}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="min-w-0 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
          {preview.path}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {formatSize(preview.size)}
        </span>
      </div>

      {preview.previewType === "image" && preview.dataUrl ? (
        <div className="bg-slate-50 p-2 dark:bg-slate-950">
          <img
            src={preview.dataUrl}
            alt={`${preview.path} 预览`}
            className="max-h-80 w-full rounded-xl object-contain"
          />
        </div>
      ) : preview.previewType === "html" ? (
        <iframe
          title={`${preview.path} 预览`}
          sandbox=""
          srcDoc={preview.content || ""}
          className="h-80 w-full bg-white dark:bg-white"
        />
      ) : preview.previewType === "pdf" && preview.dataUrl ? (
        <iframe
          title={`${preview.path} 预览`}
          src={preview.dataUrl}
          className="h-80 w-full bg-white dark:bg-white"
        />
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-3 text-xs leading-5 text-slate-100">
          {preview.content || "没有可显示的预览内容。"}
        </pre>
      )}

      {previewLabel && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          {previewLabel}
        </div>
      )}
    </div>
  );
}

function CapabilityRow({
  title,
  status,
  description,
  actionLabel,
  disabled = false,
  onAction,
}: {
  title: string;
  status: string;
  description: string;
  actionLabel?: string;
  disabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700/80 dark:bg-slate-800/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</span>
            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {status}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
