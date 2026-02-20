import { useState, useEffect, useCallback } from "react";
import type { AllMessage, ConversationHistory } from "../types";
import { getAuthHeaders, getChatSessionMessagesUrl } from "../config/api";
import { useAuth } from "../contexts/AuthContext";
import { useMessageConverter } from "./useMessageConverter";
import { getNetworkErrorMessage, parseApiErrorResponse } from "../utils/apiError";

interface HistoryLoaderState {
  messages: AllMessage[];
  loading: boolean;
  error: string | null;
  sessionId: string | null;
}

interface HistoryLoaderResult extends HistoryLoaderState {
  loadHistory: (sessionId: string) => Promise<void>;
  clearHistory: () => void;
}

/**
 * Hook for loading and converting conversation history from the backend
 */
export function useHistoryLoader(): HistoryLoaderResult {
  const { token } = useAuth();
  const { convertConversationHistory } = useMessageConverter();
  const [state, setState] = useState<HistoryLoaderState>({
    messages: [],
    loading: false,
    error: null,
    sessionId: null,
  });

  const loadHistory = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setState((prev) => ({
          ...prev,
          error: "Session ID is required",
        }));
        return;
      }

      try {
        setState((prev) => ({
          ...prev,
          loading: true,
          error: null,
        }));

        const response = await fetch(getChatSessionMessagesUrl(sessionId), {
          headers: getAuthHeaders(token),
        });

        if (!response.ok) {
          const parsed = await parseApiErrorResponse(response);
          throw new Error(parsed.message);
        }

        const data = (await response.json()) as {
          success: boolean;
          data?: ConversationHistory;
        };
        const historyMessages = data?.data?.messages || [];
        const convertedMessages = convertConversationHistory(historyMessages);

        setState((prev) => ({
          ...prev,
          messages: convertedMessages,
          loading: false,
          error: null,
          sessionId,
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          messages: [],
          loading: false,
          error: getNetworkErrorMessage(error, "加载会话历史失败"),
          sessionId,
        }));
      }
    },
    [convertConversationHistory, token],
  );

  const clearHistory = useCallback(() => {
    setState({
      messages: [],
      loading: false,
      error: null,
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
