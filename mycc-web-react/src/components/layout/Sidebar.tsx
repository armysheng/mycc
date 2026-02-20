import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlassIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SunIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../../types";
import {
  getChatSessionRenameUrl,
  getChatSessionsUrl,
  getAuthHeaders,
} from "../../config/api";
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
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

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

  const startRename = useCallback(
    (sessionId: string, currentTitle?: string | null) => {
      setRenamingSessionId(sessionId);
      setRenameDraft(currentTitle || "");
    },
    [],
  );

  const cancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameDraft("");
  }, []);

  const submitRename = useCallback(
    async (sessionId: string) => {
      const title = renameDraft.trim();
      if (!title || !token || renaming) {
        return;
      }

      try {
        setRenaming(true);
        const response = await fetch(getChatSessionRenameUrl(sessionId), {
          method: "POST",
          headers: getAuthHeaders(token),
          body: JSON.stringify({ newTitle: title }),
        });
        if (!response.ok) {
          const parsed = await parseApiErrorResponse(response);
          throw new Error(parsed.message);
        }

        await loadConversations();
        cancelRename();
      } catch (renameError) {
        setError(getNetworkErrorMessage(renameError, "重命名会话失败"));
      } finally {
        setRenaming(false);
      }
    },
    [cancelRename, loadConversations, renameDraft, renaming, token],
  );

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
      <div className="px-4 pt-5 pb-3 border-b panel-surface">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-[10px] text-white flex items-center justify-center font-bold text-[13px] tracking-[-0.3px]"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent) 0%, #D47F20 100%)",
                boxShadow: "0 2px 8px rgba(232, 169, 62, 0.3)",
              }}
            >
              cc
            </div>
            <div>
              <div
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                MyCC
              </div>
              <div className="text-[11px] text-[var(--text-muted)] tracking-[0.2px]">
                多用户助手
              </div>
            </div>
          </div>
          {overlayMode && (
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-[var(--bg-hover)]"
              aria-label="关闭侧边栏"
            >
              <XMarkIcon className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full rounded-xl px-3.5 py-2.5 text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200"
          style={{
            background: "var(--accent)",
            color: "var(--text-inverse)",
            boxShadow: "0 2px 8px rgba(232, 169, 62, 0.25)",
          }}
        >
          <PlusIcon className="w-4 h-4" />
          新对话
        </button>
      </div>

      <div className="px-4 py-2 border-b panel-surface">
        <label className="relative block">
          <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索对话"
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-xs bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            style={{
              borderColor: "var(--surface-border)",
              boxShadow: "none",
            }}
          />
        </label>
      </div>

      <div className="px-4 py-2 text-[11px] text-[var(--text-muted)] border-b">
        工作区: <span className="font-mono">{currentPathLabel || "/"}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {loading && (
          <div className="text-xs text-[var(--text-muted)] px-1">加载中...</div>
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
          <p className="text-xs text-[var(--text-muted)] px-1">暂无会话</p>
        )}

        {(["今天", "昨天", "更早"] as const).map((groupName) => {
          const list = groupedConversations[groupName] || [];
          if (list.length === 0) return null;
          return (
            <section key={groupName}>
              <h3 className="mb-1.5 px-1 text-[11px] font-medium text-[var(--text-muted)]">
                {groupName}
              </h3>
              <div className="space-y-1">
                {list.map((conversation) => {
                  const isActive = activeSessionId === conversation.sessionId;
                  const isRenaming = renamingSessionId === conversation.sessionId;
                  return (
                    <div
                      key={conversation.sessionId}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? "bg-[var(--accent-subtle)]"
                          : "border-transparent hover:bg-[var(--bg-hover)]"
                      }`}
                      style={{
                        borderColor: isActive
                          ? "var(--accent-border)"
                          : "transparent",
                      }}
                    >
                      {isRenaming ? (
                        <div className="space-y-1.5">
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitRename(conversation.sessionId);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                            className="w-full rounded-md border px-2 py-1 text-xs bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                            style={{ borderColor: "var(--accent-border)" }}
                            placeholder="输入会话名称"
                            autoFocus
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void submitRename(conversation.sessionId)}
                              disabled={renaming}
                              className="h-6 px-2 rounded border text-[11px] text-[var(--text-primary)] disabled:opacity-50"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={cancelRename}
                              disabled={renaming}
                              className="h-6 px-2 rounded border text-[11px] text-[var(--text-secondary)] disabled:opacity-50"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleConversationSelect(conversation.sessionId)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                                {conversation.customTitle || "未命名对话"}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                startRename(
                                  conversation.sessionId,
                                  conversation.customTitle,
                                )
                              }
                              className="h-5 w-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                              title="重命名会话"
                              aria-label="重命名会话"
                            >
                              <PencilIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleConversationSelect(conversation.sessionId)}
                            className="mt-1 w-full text-left"
                          >
                            <p className="text-[11px] text-[var(--text-secondary)] truncate">
                              {conversation.lastMessagePreview}
                            </p>
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="px-3 py-3 border-t panel-surface">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)] flex items-center justify-center text-xs font-semibold">
            {avatarChar}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate text-[var(--text-primary)]">
              {displayName}
            </p>
            <p className="text-[11px] text-[var(--text-muted)] truncate">
              {user?.plan || "free"}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-[var(--bg-hover)]"
            aria-label="切换主题"
            title="切换主题"
          >
            {theme === "dark" ? (
              <SunIcon className="w-4 h-4 text-[var(--text-secondary)]" />
            ) : (
              <MoonIcon className="w-4 h-4 text-[var(--text-secondary)]" />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-8 px-2 rounded-md border panel-surface text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            设置
          </button>
        </div>
      </div>
    </aside>
  );
}
