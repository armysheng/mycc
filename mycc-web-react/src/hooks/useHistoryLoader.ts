import { useState, useEffect, useCallback } from "react";
import type { AllMessage, TimestampedSDKMessage } from "../types";
import { getChatSessionMessagesUrl, getAuthHeaders } from "../config/api";
import { convertConversationHistory } from "../utils/messageConversion";
import { useAuth } from "../contexts/AuthContext";

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

      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        sessionId,
      }));

      try {
        const response = await fetch(getChatSessionMessagesUrl(sessionId), {
          headers: getAuthHeaders(token),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to load messages: ${response.status} ${response.statusText}`,
          );
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
        }));
      } catch (err) {
        console.error("Failed to load conversation history:", err);
        setState((prev) => ({
          ...prev,
          messages: [],
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : "Failed to load conversation history",
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
