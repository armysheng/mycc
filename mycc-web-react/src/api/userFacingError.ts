import { getNetworkErrorMessage } from "../utils/apiError";

const INTERNAL_ERROR_PATTERN =
  /\b(?:MyCC|E2B|mycc_u[\w-]*|linuxUser|desktop_pid)\b|\/home\/mycc|Command failed|exit code \d+|exit status \d+|invalid_argument|\/bin\/(?:ba)?sh|bridge\.mjs/i;

const API_LOW_LEVEL_PATTERN = /\b(?:sandbox|token|provider)\b/i;
const RUNTIME_STRONG_INTERNAL_PATTERN =
  /\b(?:MyCC|E2B|mycc_u[\w-]*|linuxUser|desktop_pid)\b|\/home\/mycc|bridge\.mjs/i;
const RUNTIME_ERROR_CONTEXT_PATTERN =
  /\b(?:fail(?:ed|ure)?|error|missing|invalid|expired|timeout|unavailable|unauthori[sz]ed|forbidden|denied|exception|Bad Request|Internal Server Error|request failed|exit code \d+|exit status \d+|invalid_argument)\b/i;

export function containsInternalErrorDetails(message: string): boolean {
  return INTERNAL_ERROR_PATTERN.test(message) || API_LOW_LEVEL_PATTERN.test(message);
}

export function containsRuntimeErrorDetails(message: string): boolean {
  return (
    RUNTIME_STRONG_INTERNAL_PATTERN.test(message) ||
    (API_LOW_LEVEL_PATTERN.test(message) &&
      RUNTIME_ERROR_CONTEXT_PATTERN.test(message))
  );
}

export function toUserFacingError(
  message: string | undefined,
  fallback: string,
): string {
  if (!message) return fallback;
  if (containsInternalErrorDetails(message)) {
    return fallback;
  }
  return getNetworkErrorMessage(new Error(message), fallback);
}

export function toRetryableUserFacingError(
  message: string | undefined,
  fallbackPrefix: string,
): string {
  if (!message) return fallbackPrefix;
  return toUserFacingError(message, `${fallbackPrefix}，请稍后重试`);
}
