import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../../types";
import { getChatSessionsUrl, getChatSessionRenameUrl, getAuthHeaders } from "../../config/api";
import { useAuth } from "../../contexts/AuthContext";

interface SidebarProps {
  onNewChat: () => void;
  currentPathLabel?: string;
  desktopVisible?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHr < 24) return `${diffHr}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return date.toLocaleDateString();
}

export function Sidebar({
  onNewChat,
  desktopVisible = true,
  isOpen,
  onClose,
  onOpenSettings,
}: SidebarProps) {
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getChatSessionsUrl()}?limit=30&offset=0`, {
        headers: getAuthHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        const rows = data?.data?.conversations || [];
        setConversations(
          rows.map((item: any) => ({
            sessionId: item.sessionId,
            startTime: item.createdAt,
            lastTime: item.updatedAt,
            messageCount: item.messageCount ?? 0,
            lastMessagePreview: item.title || "Untitled",
            customTitle: item.title || null,
          })),
        );
      }
      setDataLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && !dataLoaded) {
      loadConversations();
    }
  }, [token, dataLoaded, loadConversations]);

  const handleRefresh = useCallback(() => {
    setDataLoaded(false);
  }, []);

  useEffect(() => {
    if (!token) {
      setConversations([]);
      setDataLoaded(false);
    }
  }, [token]);

  const handleSelectSession = (sessionId: string) => {
    navigate(`/?sessionId=${encodeURIComponent(sessionId)}`);
    onClose();
  };

  const handleRename = useCallback(async (sessionId: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed || !token) {
      setEditingId(null);
      return;
    }
    try {
      const res = await fetch(getChatSessionRenameUrl(sessionId), {
        method: "PUT",
        headers: getAuthHeaders(token),
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.sessionId === sessionId ? { ...c, customTitle: trimmed } : c
          )
        );
      }
    } catch {
      // 静默失败
    }
    setEditingId(null);
  }, [editTitle, token]);

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const userInitial = user?.nickname?.charAt(0)?.toUpperCase() || "U";
  const userDisplayName =
    user?.nickname || user?.email || user?.phone || "用户";

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="p-4 border-b panel-surface">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-lg text-white flex items-center justify-center font-semibold"
            style={{ background: "var(--accent)" }}
          >
            cc
          </div>
          <div>
            <div className="text-sm font-semibold">MyCC</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              多用户助手
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-700 text-white transition-colors mb-2"
        >
          + 新对话
        </button>
        {/* 快捷入口 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              navigate("/skills");
              onClose();
            }}
            className="flex-1 px-2 py-1.5 text-xs rounded-md border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ⚡ 技能
          </button>
        </div>
      </div>

      {/* 对话列表（始终显示） */}
      <div className="p-4 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            历史对话
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-2 py-0.5 text-xs rounded border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800"
            title="刷新"
          >
            ↻
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 p-2 text-xs text-red-600 dark:text-red-400 mb-2">
            {error}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <div className="text-xs text-slate-400 dark:text-slate-500 py-2">
            暂无对话记录
          </div>
        )}

        {!loading && conversations.length > 0 && (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.sessionId}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectSession(conv.sessionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSelectSession(conv.sessionId);
                }}
                className="group w-full text-left rounded-lg px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <div className="font-medium text-slate-700 dark:text-slate-200 truncate flex-1">
                    {editingId === conv.sessionId ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") handleRename(conv.sessionId);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => handleRename(conv.sessionId)}
                        autoFocus
                        className="w-full text-xs font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 outline-none"
                      />
                    ) : (
                      conv.customTitle || conv.lastMessagePreview || conv.sessionId.substring(0, 8)
                    )}
                  </div>
                  {editingId !== conv.sessionId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(conv.sessionId);
                        setEditTitle(conv.customTitle || conv.lastMessagePreview || "");
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-opacity shrink-0"
                    >
                      ✎
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-slate-400 dark:text-slate-500">
                  <span>
                    {formatTime(conv.lastTime || conv.startTime)}
                  </span>
                  <span>{conv.messageCount} 条</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部用户信息 */}
      <div className="p-4 border-t panel-surface relative" ref={userMenuRef}>
        {/* 弹出菜单 */}
        {userMenuOpen && (
          <div className="absolute bottom-full left-4 right-4 mb-2 rounded-lg border panel-surface shadow-lg py-1 z-10">
            <button
              type="button"
              onClick={() => {
                navigate("/skills");
                setUserMenuOpen(false);
                onClose();
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              ⚡ 技能管理
            </button>
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                onOpenSettings?.();
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              ⚙ 设置
            </button>
            <div className="border-t my-1" />
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                logout();
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              退出登录
            </button>
          </div>
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setUserMenuOpen(v => !v)}
          onKeyDown={(e) => { if (e.key === "Enter") setUserMenuOpen(v => !v); }}
          className="flex items-center gap-3 cursor-pointer rounded-lg p-1 -m-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <div
            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-sm font-semibold shrink-0"
            style={{ background: "var(--accent)" }}
          >
            {userInitial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {userDisplayName}
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 桌面端固定 Sidebar */}
      <aside
        className={`panel-surface border-r ${desktopVisible ? 'hidden lg:flex' : 'hidden'} flex-col shrink-0`}
        style={{ width: "var(--sidebar-width)" }}
      >
        {sidebarContent}
      </aside>

      {/* 移动端抽屉 */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={onClose}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 lg:hidden flex flex-col panel-surface shadow-xl">
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  );
}
