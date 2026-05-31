import { useState, useEffect, useCallback } from "react";
import type { AllMessage, TimestampedSDKMessage } from "../types";
import { getChatSessionMessagesUrl, getAuthHeaders } from "../config/api";
import { convertConversationHistory } from "../utils/messageConversion";
import { useAuth } from "../contexts/AuthContext";

interface HistoryLoaderState {
  messages: AllMessage[];
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  sessionId: string | null;
}

interface HistoryLoaderResult extends HistoryLoaderState {
  loadHistory: (sessionId: string) => Promise<void>;
  clearHistory: () => void;
}

const HISTORY_LOAD_ERROR_MESSAGE =
  "这段旧对话暂时没读出来，原记录不会被删除。可以先回到新对话，稍后再试一次。";

/**
 * Hook for loading and converting conversation history from the backend
 */
export function useHistoryLoader(): HistoryLoaderResult {
  const { token } = useAuth();
  const [state, setState] = useState<HistoryLoaderState>({
    messages: [],
    loading: false,
    error: null,
    errorStatus: null,
    sessionId: null,
  });

  const loadHistory = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setState((prev) => ({
          ...prev,
          error: "请选择要打开的对话",
          errorStatus: null,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        errorStatus: null,
        sessionId,
      }));

      try {
        const response = await fetch(getChatSessionMessagesUrl(sessionId), {
          headers: getAuthHeaders(token),
        });

        if (!response.ok) {
          const error = new Error(HISTORY_LOAD_ERROR_MESSAGE) as Error & {
            status?: number;
          };
          error.status = response.status;
          throw error;
        }

        const data = await response.json();
        const rawMessages: TimestampedSDKMessage[] =
          data?.data?.messages || [];

        const converted = convertConversationHistory(rawMessages);

        setState((prev) => ({
          ...prev,
          messages: converted,
          loading: false,
          error: null,
          errorStatus: null,
        }));
      } catch (err) {
        console.error("Failed to load conversation history:", err);
        const status =
          typeof (err as { status?: unknown }).status === "number"
            ? (err as { status: number }).status
            : null;
        setState((prev) => ({
          ...prev,
          messages: [],
          loading: false,
          error: HISTORY_LOAD_ERROR_MESSAGE,
          errorStatus: status,
        }));
      }
    },
    [token],
  );

  const clearHistory = useCallback(() => {
    setState({
      messages: [],
      loading: false,
      error: null,
      errorStatus: null,
      sessionId: null,
    });
  }, []);

  return {
    ...state,
    loadHistory,
    clearHistory,
  };
}

/**
 * Hook for loading conversation history on mount when sessionId is provided
 */
export function useAutoHistoryLoader(
  sessionId?: string,
): HistoryLoaderResult {
  const historyLoader = useHistoryLoader();

  useEffect(() => {
    if (sessionId) {
      historyLoader.loadHistory(sessionId);
    } else if (!sessionId) {
      historyLoader.clearHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return historyLoader;
}
