import { useCallback } from "react";
import { getAbortUrl, getAuthHeaders } from "../../config/api";

export type AbortRequestResult = {
  active: boolean;
  message: string;
};

export function useAbortController(token: string | null) {
  // Helper function to perform abort request
  const performAbortRequest = useCallback(async (requestId: string) => {
    const response = await fetch(getAbortUrl(requestId), {
      method: "POST",
      headers: getAuthHeaders(token),
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(parsed?.error || parsed?.message || "暂停请求失败");
    }
    const payload =
      parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    return {
      active: Boolean(payload?.active),
      message:
        typeof payload?.message === "string" && payload.message.trim()
          ? payload.message
          : payload?.active
            ? "已暂停这次任务"
            : "这次任务已经结束",
    } satisfies AbortRequestResult;
  }, [token]);

  const abortRequest = useCallback(
    async (
      requestId: string | null,
      isLoading: boolean,
      onAbortComplete?: (result: AbortRequestResult) => void,
    ) => {
      if (!requestId || !isLoading) return null;

      const result = await performAbortRequest(requestId);
      onAbortComplete?.(result);
      return result;
    },
    [performAbortRequest],
  );

  const createAbortHandler = useCallback(
    (requestId: string) => async () => {
      return performAbortRequest(requestId);
    },
    [performAbortRequest],
  );

  return {
    abortRequest,
    createAbortHandler,
  };
}
