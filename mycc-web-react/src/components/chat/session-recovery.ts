import type { ParsedApiError } from "../../utils/apiError";

export function shouldRecoverFromForbiddenSession(
  parsed: ParsedApiError,
  hasSessionId: boolean,
  attempt: number,
): boolean {
  return (
    parsed.status === 403 &&
    parsed.backendError.includes("会话") &&
    hasSessionId &&
    attempt === 0
  );
}
