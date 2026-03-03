import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tree, type NodeRendererProps } from "react-arborist";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  getAuthHeaders,
  getWorkspaceExecUrl,
  getWorkspaceFileUrl,
  getWorkspaceSaveFileUrl,
  getWorkspaceTreeUrl,
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

interface WorkspaceExecData {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function normalizePath(input: string): string {
  const segments = input.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join("/")}`;
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

export function WorkspacePage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [treeRoot, setTreeRoot] = useState<WorkspaceTreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<WorkspaceFileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [terminalCwd, setTerminalCwd] = useState("/");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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
      throw new Error(json?.error || "请求失败");
    }
    return json;
  }, [token]);

  const appendTerminal = useCallback((text: string) => {
    const term = terminalRef.current;
    if (!term) return;
    term.write(text.replace(/\n/g, "\r\n"));
  }, []);

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
        setNotice("目录节点过多，已自动截断展示。可通过命令行进一步查看。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载目录失败");
    } finally {
      setTreeLoading(false);
    }
  }, [apiFetch]);

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
        setNotice("文件超过 1MB，仅加载前 1MB 内容用于编辑。\n");
      }
      if (file.binary) {
        setNotice("当前是二进制文件，暂不支持在线编辑。\n");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取文件失败");
    } finally {
      setFileLoading(false);
    }
  }, [apiFetch]);

  const runTerminalCommand = useCallback(async () => {
    const cmd = terminalCommand.trim();
    if (!cmd) return;

    appendTerminal(`\n$ ${cmd}\n`);
    setTerminalRunning(true);
    setTerminalCommand("");

    try {
      const isCd = cmd === "cd" || cmd.startsWith("cd ");
      if (isCd) {
        const target = cmd === "cd" ? "/" : normalizePath(`${terminalCwd}/${cmd.slice(3).trim()}`);
        const verify = await apiFetch(getWorkspaceExecUrl(), {
          method: "POST",
          body: JSON.stringify({
            cwd: target,
            command: "pwd",
          }),
        });
        const result = verify?.data as WorkspaceExecData;
        if (result.exitCode === 0) {
          const nextCwd = normalizePath(result.cwd || target);
          setTerminalCwd(nextCwd);
          appendTerminal(`已切换目录: ${nextCwd}\n`);
        } else {
          appendTerminal(result.stderr || "目录切换失败\n");
        }
      } else {
        const json = await apiFetch(getWorkspaceExecUrl(), {
          method: "POST",
          body: JSON.stringify({
            cwd: terminalCwd,
            command: cmd,
          }),
        });
        const result = json?.data as WorkspaceExecData;
        if (result.stdout) {
          appendTerminal(result.stdout);
          appendTerminal("\n");
        }
        if (result.stderr) {
          appendTerminal(result.stderr);
          appendTerminal("\n");
        }
        if (result.timedOut) {
          appendTerminal("[命令超时]\n");
        }
        setTerminalCwd(normalizePath(result.cwd || terminalCwd));
        if (result.exitCode !== 0) {
          appendTerminal(`[exit ${result.exitCode}]\n`);
        }
      }
    } catch (err) {
      appendTerminal(`ERROR: ${err instanceof Error ? err.message : "执行失败"}\n`);
    } finally {
      setTerminalRunning(false);
    }
  }, [apiFetch, appendTerminal, terminalCommand, terminalCwd]);

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

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0b1220",
        foreground: "#dbeafe",
        cursor: "#f8fafc",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalHostRef.current);
    fit.fit();
    term.writeln("MyCC Workspace Terminal");
    term.writeln("提示: 当前为命令执行模式（非交互 shell）");
    term.writeln("------------------------------------");
    terminalRef.current = term;
    fitAddonRef.current = fit;

    const handleResize = () => {
      fit.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      fit.dispose();
      term.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!activeFile || activeFile.binary) return false;
    return (activeFile.content || "") !== draftContent;
  }, [activeFile, draftContent]);

  const onTreeNodeClick = useCallback((node: WorkspaceTreeNode) => {
    setActivePath(node.path);
    if (node.type === "directory") {
      setTerminalCwd(normalizePath(node.path));
      return;
    }
    void loadFile(node.path);
  }, [loadFile]);

  const renderTreeNode = useCallback(({ node, style }: NodeRendererProps<WorkspaceTreeNode>) => {
    const data = node.data;
    const selected = activePath === data.path;
    const isDir = data.type === "directory";

    return (
      <div
        style={style}
        onClick={() => {
          if (isDir) {
            node.toggle();
          }
          onTreeNodeClick(data);
        }}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer border ${
          selected
            ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200"
            : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        <span className="text-xs w-4 text-center">{isDir ? (node.isOpen ? "📂" : "📁") : "📄"}</span>
        <span className="truncate">{data.name}</span>
      </div>
    );
  }, [activePath, onTreeNodeClick]);

  const data = treeRoot ? [treeRoot] : [];

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar onNewChat={() => navigate("/")} isOpen={false} onClose={() => {}} />

      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="px-6 py-4 border-b panel-surface flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">工作区</h1>
            <p className="text-xs text-slate-500 mt-1">react-arborist + Monaco + xterm.js（命令执行模式）</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadTree}
              className="px-3 py-1.5 rounded-lg border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              刷新目录
            </button>
            <button
              type="button"
              onClick={saveCurrentFile}
              disabled={!dirty || saving || !activeFile || activeFile.binary}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "保存中..." : "保存文件"}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden grid grid-cols-12 gap-0">
          <aside className="col-span-3 border-r panel-surface overflow-hidden flex flex-col">
            <div className="px-3 py-2 text-xs text-slate-500 border-b">文件树</div>
            <div className="flex-1 overflow-auto p-2">
              {treeLoading ? (
                <div className="text-xs text-slate-500 px-2 py-3">加载目录中...</div>
              ) : (
                <Tree<WorkspaceTreeNode>
                  data={data}
                  childrenAccessor="children"
                  idAccessor="id"
                  rowHeight={32}
                  width="100%"
                  height={Math.max(window.innerHeight - 220, 320)}
                  indent={18}
                >
                  {renderTreeNode}
                </Tree>
              )}
            </div>
          </aside>

          <section className="col-span-6 border-r overflow-hidden flex flex-col bg-white dark:bg-slate-950">
            <div className="px-3 py-2 border-b text-xs text-slate-500 flex items-center justify-between">
              <span className="truncate">{activeFile?.path || "请选择文件"}</span>
              {activeFile && (
                <span>
                  {formatSize(activeFile.size)} · {formatTime(activeFile.mtime)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {fileLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">读取文件中...</div>
              ) : !activeFile ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">从左侧文件树选择一个文本文件</div>
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

          <section className="col-span-3 overflow-hidden flex flex-col panel-surface">
            <div className="px-3 py-2 border-b text-xs text-slate-500">终端 · cwd: {terminalCwd}</div>
            <div className="flex-1 min-h-0 bg-[#0b1220]">
              <div ref={terminalHostRef} className="w-full h-full" />
            </div>
            <div className="p-2 border-t flex items-center gap-2">
              <input
                value={terminalCommand}
                onChange={(e) => setTerminalCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !terminalRunning) {
                    void runTerminalCommand();
                  }
                }}
                placeholder="输入命令，如 ls -la / cd src"
                className="flex-1 rounded-lg border px-2 py-1.5 text-xs panel-surface outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
              />
              <button
                type="button"
                onClick={() => {
                  void runTerminalCommand();
                }}
                disabled={terminalRunning}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {terminalRunning ? "执行中" : "运行"}
              </button>
            </div>
          </section>
        </div>

        {(error || notice) && (
          <div className="px-6 py-3 border-t panel-surface text-sm">
            {error && <div className="text-red-600">系统错误：{error}</div>}
            {notice && <div className="text-emerald-600">{notice}</div>}
          </div>
        )}
      </main>
    </div>
  );
}
