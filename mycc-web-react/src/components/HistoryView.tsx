import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ConversationSummary } from "../types";
import { getChatSessionsUrl, getAuthHeaders } from "../config/api";
import { useAuth } from "../contexts/AuthContext";

interface HistoryViewProps {
  onBack?: () => void;
}

const HISTORY_LIST_ERROR_MESSAGE =
  "历史记录暂时没读出来，原记录不会被删除。可以先回到新对话，稍后再试一次。";
const UNTITLED_CONVERSATION_LABEL = "未命名对话";

export function HistoryView(_props: HistoryViewProps) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuth();

  useEffect(() => {
    const loadConversations = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${getChatSessionsUrl()}?limit=100&offset=0`, {
          headers: getAuthHeaders(token),
        });

        if (!response.ok) {
          throw new Error(HISTORY_LIST_ERROR_MESSAGE);
        }
        const data = await response.json();
        const rows = data?.data?.conversations || [];
        const mapped: ConversationSummary[] = rows.map((item: any) => ({
          sessionId: item.sessionId,
          startTime: item.createdAt,
          lastTime: item.updatedAt,
          messageCount: item.messageCount ?? 0,
          lastMessagePreview: item.title || UNTITLED_CONVERSATION_LABEL,
          customTitle: item.title || null,
        }));
        setConversations(mapped);
      } catch {
        setError(HISTORY_LIST_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    };

    loadConversations();
  }, [token]);

  const handleConversationSelect = (sessionId: string) => {
    const searchParams = new URLSearchParams();
    searchParams.set("sessionId", sessionId);
    navigate({ search: searchParams.toString() });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">
            正在读取历史记录...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
            历史记录暂时没读出来
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-400 dark:text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
            还没有历史记录
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm max-w-sm">
            开始一次对话后，这里会显示最近记录。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <div className="p-6 h-full flex flex-col">
        <div className="grid gap-4 flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <div
              key={conversation.sessionId}
              onClick={() => handleConversationSelect(conversation.sessionId)}
              className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors cursor-pointer shadow-sm hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {conversation.lastMessagePreview || "未命名对话"}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {new Date(conversation.startTime).toLocaleString()} •{" "}
                    {conversation.messageCount} 条消息
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 line-clamp-2">
                    {conversation.lastMessagePreview}
                  </p>
                </div>
                <div className="ml-4 flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
