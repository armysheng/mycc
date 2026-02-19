interface ApiErrorBody {
  error?: string;
  message?: string;
  remaining?: number;
}

export interface ParsedApiError {
  status: number;
  message: string;
  backendError: string;
  remaining: number | null;
}

export async function parseApiErrorResponse(
  response: Response,
): Promise<ParsedApiError> {
  let backendError = "";
  let remaining: number | null = null;

  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as ApiErrorBody;
      backendError = data.error || data.message || "";
      if (typeof data.remaining === "number") {
        remaining = data.remaining;
      }
    } else {
      backendError = (await response.text()).trim();
    }
  } catch {
    // Ignore response parsing errors and use status fallback.
  }

  let message = "请求失败，请稍后重试。";
  if (response.status === 401) {
    message = "登录已失效，请重新登录后再试。";
  } else if (response.status === 403) {
    if (backendError.includes("会话")) {
      message = "该会话无访问权限，请新建会话后再试。";
    } else if (backendError.includes("额度已用完")) {
      message =
        remaining !== null
          ? `额度已用完（剩余 ${remaining}），请重置额度或升级套餐后再试。`
          : "额度已用完，请重置额度或升级套餐后再试。";
    } else {
      message = "当前请求无权限执行，请检查账号状态后重试。";
    }
  } else if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    message = retryAfter
      ? `请求过于频繁，请 ${retryAfter} 秒后重试。`
      : "请求过于频繁，请稍后重试。";
  } else if (response.status >= 500) {
    message = "服务暂时不可用，请稍后重试。";
  } else if (backendError) {
    message = backendError;
  }

  const rawDetail = backendError
    ? `原始错误: ${backendError}`
    : `HTTP ${response.status}`;

  if (!message.includes(rawDetail)) {
    message = `${message}（${rawDetail}）`;
  }

  return {
    status: response.status,
    message,
    backendError,
    remaining,
  };
}

export function getNetworkErrorMessage(
  error: unknown,
  fallback = "请求失败，请稍后重试。",
): string {
  if (error instanceof Error) {
    if (error.message.includes("原始错误:")) {
      return error.message;
    }
    if (error.message === "Failed to fetch") {
      return "网络连接失败，请检查前后端服务和 CORS 配置。（原始错误: Failed to fetch）";
    }
    return error.message || fallback;
  }
  return fallback;
}
