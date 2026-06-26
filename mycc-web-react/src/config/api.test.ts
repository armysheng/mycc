import { describe, expect, it } from "vitest";
import {
  getWorkspaceFileUrl,
  getWorkspacePreviewUrl,
  getWorkspaceSaveFileUrl,
  getWorkspaceTreeUrl,
  resolveIdeOpenUrl,
} from "./api";

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

describe("workspace API urls", () => {
  it("can bind file operations to a specific MyCC workbench session", () => {
    expect(getWorkspaceTreeUrl("/", 3, "ide_123")).toBe(
      "/api/workspace/tree?path=%2F&depth=3&ideSessionId=ide_123",
    );
    expect(getWorkspaceFileUrl("/report.md", "ide_123")).toBe(
      "/api/workspace/file?path=%2Freport.md&ideSessionId=ide_123",
    );
    expect(getWorkspacePreviewUrl("/report.md", "ide_123")).toBe(
      "/api/workspace/preview?path=%2Freport.md&ideSessionId=ide_123",
    );
    expect(getWorkspaceSaveFileUrl("ide_123")).toBe(
      "/api/workspace/file?ideSessionId=ide_123",
    );
  });
});
