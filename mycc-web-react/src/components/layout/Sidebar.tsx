import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../../types";
import { getChatSessionsUrl, getAuthHeaders } from "../../config/api";
import { useAuth } from "../../contexts/AuthContext";

interface SidebarProps {
  onNewChat: () => void;
  currentPathLabel?: string;
  isOpen: boolean;
  onClose: () => void;
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
  isOpen,
  onClose,
}: SidebarProps) {
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

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
              <button
                key={conv.sessionId}
                type="button"
                onClick={() => handleSelectSession(conv.sessionId)}
                className="w-full text-left rounded-lg px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="font-medium text-slate-700 dark:text-slate-200 truncate">
                  {conv.customTitle ||
                    conv.lastMessagePreview ||
                    conv.sessionId.substring(0, 8)}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-slate-400 dark:text-slate-500">
                  <span>
                    {formatTime(conv.lastTime || conv.startTime)}
                  </span>
                  <span>{conv.messageCount} 条</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部用户信息 */}
      <div className="p-4 border-t panel-surface">
        <div className="flex items-center gap-3">
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
          <button
            type="button"
            onClick={logout}
            className="text-xs text-slate-500 hover:text-red-500 transition-colors shrink-0"
          >
            退出
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 桌面端固定 Sidebar */}
      <aside
        className="panel-surface border-r hidden lg:flex flex-col shrink-0"
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
