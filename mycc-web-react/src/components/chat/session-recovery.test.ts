import { describe, expect, it } from "vitest";
import { shouldRecoverFromForbiddenSession } from "./session-recovery";
import type { ParsedApiError } from "../../utils/apiError";

function makeParsedError(
  overrides: Partial<ParsedApiError> = {},
): ParsedApiError {
  return {
    status: 403,
    message: "该会话无访问权限，请新建会话后再试。（原始错误: 无权访问该会话）",
    backendError: "无权访问该会话",
    remaining: null,
    ...overrides,
  };
}

describe("shouldRecoverFromForbiddenSession", () => {
  it("403+会话错误+有 sessionId+首次尝试时返回 true", () => {
    expect(
      shouldRecoverFromForbiddenSession(makeParsedError(), true, 0),
    ).toBe(true);
  });

  it("非首次尝试时返回 false（避免无限重试）", () => {
    expect(
      shouldRecoverFromForbiddenSession(makeParsedError(), true, 1),
    ).toBe(false);
  });

  it("无 sessionId 时返回 false", () => {
    expect(
      shouldRecoverFromForbiddenSession(makeParsedError(), false, 0),
    ).toBe(false);
  });

  it("非会话 403 返回 false", () => {
    expect(
      shouldRecoverFromForbiddenSession(
        makeParsedError({
          backendError: "当前请求无权限执行",
        }),
        true,
        0,
      ),
    ).toBe(false);
  });
});
