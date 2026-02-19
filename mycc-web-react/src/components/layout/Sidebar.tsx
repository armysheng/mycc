import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlassIcon,
  MoonIcon,
  SunIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../../types";
import { getChatSessionsUrl, getAuthHeaders } from "../../config/api";
import { useAuth } from "../../contexts/AuthContext";
import { useSettings } from "../../hooks/useSettings";
import { getNetworkErrorMessage, parseApiErrorResponse } from "../../utils/apiError";

interface SidebarProps {
  onNewChat: () => void;
  onOpenSettings: () => void;
  currentPathLabel?: string;
  activeSessionId?: string | null;
  overlayMode?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

interface ConversationRow {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  title?: string;
}

function toConversationSummary(item: ConversationRow): ConversationSummary {
  return {
    sessionId: item.sessionId,
    startTime: item.createdAt,
    lastTime: item.updatedAt,
    messageCount: item.messageCount ?? 0,
    lastMessagePreview: item.title || "Untitled conversation",
    customTitle: item.title || null,
  };
}

function getDateGroupLabel(lastTime: string): "今天" | "昨天" | "更早" {
  const target = new Date(lastTime);
  const now = new Date();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((today - targetDay) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  return "更早";
}

export function Sidebar({
  onNewChat,
  onOpenSettings,
  currentPathLabel,
  activeSessionId,
  overlayMode = false,
  isOpen = true,
  onClose,
}: SidebarProps) {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { theme, toggleTheme, profileNickname } = useSettings();
  const [searchValue, setSearchValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${getChatSessionsUrl()}?limit=100&offset=0`, {
        headers: getAuthHeaders(token),
      });
      if (!response.ok) {
        const parsed = await parseApiErrorResponse(response);
        throw new Error(parsed.message);
      }
      const data = await response.json();
      const rows: ConversationRow[] = data?.data?.conversations || [];
      setConversations(rows.map(toConversationSummary));
    } catch (fetchError) {
      setError(getNetworkErrorMessage(fetchError, "加载会话列表失败"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const groupedConversations = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    const filtered = conversations
      .filter((item) => {
        if (!normalizedSearch) return true;
        return (
          item.lastMessagePreview.toLowerCase().includes(normalizedSearch) ||
          item.sessionId.toLowerCase().includes(normalizedSearch)
        );
      })
      .sort((a, b) => Date.parse(b.lastTime) - Date.parse(a.lastTime));

    return filtered.reduce<Record<string, ConversationSummary[]>>((acc, item) => {
      const label = getDateGroupLabel(item.lastTime);
      if (!acc[label]) acc[label] = [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [conversations, searchValue]);

  const handleConversationSelect = useCallback(
    (sessionId: string) => {
      const params = new URLSearchParams();
      params.set("sessionId", sessionId);
      navigate({ search: params.toString() });
      onClose?.();
    },
    [navigate, onClose],
  );

  const displayName =
    profileNickname ||
    user?.nickname ||
    user?.email ||
    user?.phone ||
    user?.linux_user ||
    "未登录用户";
  const avatarChar = displayName.charAt(0).toUpperCase();

  const handleNewChat = useCallback(() => {
    onNewChat();
    onClose?.();
  }, [onNewChat, onClose]);

  const sidebarClassName = overlayMode
    ? `panel-surface border-r flex flex-col fixed inset-y-0 left-0 z-40 shadow-xl transition-transform duration-200 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`
    : "panel-surface border-r flex flex-col shrink-0";

  return (
    <aside
      className={sidebarClassName}
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="p-4 border-b panel-surface">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500 text-white flex items-center justify-center font-semibold">
              cc
            </div>
            <div>
              <div className="text-sm font-semibold">MyCC</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                多用户助手
              </div>
            </div>
          </div>
          {overlayMode && (
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="关闭侧边栏"
            >
              <XMarkIcon className="h-4 w-4 text-slate-500" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white transition-colors"
        >
          新对话
        </button>
      </div>

      <div className="p-3 border-b panel-surface">
        <label className="relative block">
          <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索对话"
            className="w-full rounded-lg border panel-surface pl-8 pr-3 py-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
      </div>

      <div className="p-3 text-[11px] text-slate-500 dark:text-slate-400 border-b">
        工作区: <span className="font-mono">{currentPathLabel || "/"}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && (
          <div className="text-xs text-slate-500 dark:text-slate-400">加载中...</div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
            <button
              type="button"
              onClick={loadConversations}
              className="mt-2 text-xs text-red-700 dark:text-red-300 underline"
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && Object.keys(groupedConversations).length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">暂无会话</p>
        )}

        {(["今天", "昨天", "更早"] as const).map((groupName) => {
          const list = groupedConversations[groupName] || [];
          if (list.length === 0) return null;
          return (
            <section key={groupName}>
              <h3 className="mb-2 px-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {groupName}
              </h3>
              <div className="space-y-1.5">
                {list.map((conversation) => {
                  const isActive = activeSessionId === conversation.sessionId;
                  return (
                    <button
                      key={conversation.sessionId}
                      type="button"
                      onClick={() => handleConversationSelect(conversation.sessionId)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        isActive
                          ? "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/20"
                          : "border-transparent hover:border-slate-200 hover:bg-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                      }`}
                    >
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                        {conversation.customTitle || "未命名对话"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {conversation.lastMessagePreview}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="p-3 border-t panel-surface">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-xs font-semibold">
            {avatarChar}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{displayName}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {user?.plan || "free"}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="切换主题"
            title="切换主题"
          >
            {theme === "dark" ? (
              <SunIcon className="w-4 h-4 text-slate-500" />
            ) : (
              <MoonIcon className="w-4 h-4 text-slate-500" />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-8 px-2 rounded-md border panel-surface text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            设置
          </button>
        </div>
      </div>
    </aside>
  );
}
