import { describe, expect, it } from "vitest";
import { toRetryableUserFacingError } from "./userFacingError";

describe("userFacingError", () => {
  it("hides low-level runtime errors from API callers", () => {
    const message =
      "Command failed with exit code 1: /bin/bash -lc node bridge.mjs provider desktop_pid invalid_argument";

    expect(toRetryableUserFacingError(message, "操作失败")).toBe(
      "操作失败，请稍后重试",
    );
  });

  it("hides secret-bearing API errors from users", () => {
    const messages = [
      "missing secret in OAuth callback",
      "invalid client_secret for provider",
      "api_key rejected by upstream",
      "Authorization header expired",
      "password grant denied",
    ];

    for (const message of messages) {
      expect(toRetryableUserFacingError(message, "登录失败")).toBe(
        "登录失败，请稍后重试",
      );
    }
  });
});
