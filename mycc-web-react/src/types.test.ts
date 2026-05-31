import { describe, expect, it } from "vitest";
import { fromSDKPermissionMode, toSDKPermissionMode } from "./types";

describe("permission mode SDK mapping", () => {
  it("keeps bypassPermissions as an explicit UI mode", () => {
    expect(fromSDKPermissionMode("bypassPermissions")).toBe("bypassPermissions");
    expect(toSDKPermissionMode("bypassPermissions")).toBe("bypassPermissions");
  });

  it("preserves manually selectable standard execution mode", () => {
    expect(fromSDKPermissionMode("default")).toBe("default");
    expect(toSDKPermissionMode("default")).toBe("default");
  });
});
