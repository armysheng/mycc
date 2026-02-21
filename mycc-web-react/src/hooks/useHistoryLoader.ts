import { useState, useEffect, useCallback } from "react";
import type { AllMessage } from "../types";

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

      // Current backend stores session metadata, not full message transcripts.
      // Keep message list empty and set sessionId so follow-up messages can resume.
      setState((prev) => ({
        ...prev,
        messages: [],
        loading: false,
        error: null,
        sessionId,
      }));
    },
    [],
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
