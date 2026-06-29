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
});
