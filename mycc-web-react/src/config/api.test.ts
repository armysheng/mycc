import { describe, expect, it } from "vitest";
import { resolveIdeOpenUrl } from "./api";

describe("resolveIdeOpenUrl", () => {
  it("resolves IDE open paths through the same-origin MyCC proxy", () => {
    expect(resolveIdeOpenUrl("/api/ide/sessions/ide_123/proxy/")).toBe(
      `${window.location.origin}/api/ide/sessions/ide_123/proxy/`,
    );
  });

  it("rejects absolute provider URLs for IDE surfaces", () => {
    expect(() =>
      resolveIdeOpenUrl("https://16080-sbx_provider.e2b.app/vnc.html"),
    ).toThrow("IDE open path must be a MyCC proxy path");
  });
});
