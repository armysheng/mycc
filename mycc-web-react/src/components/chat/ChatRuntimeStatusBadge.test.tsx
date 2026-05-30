import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeStatusBadge } from "./ChatRuntimeStatusBadge";

function okJson(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  };
}

describe("ChatRuntimeStatusBadge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows E2B Agent SDK and CCR readiness without exposing provider details", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({
      kind: "e2b-claude-agent-sdk",
      executionEnvironment: "e2b",
      usesAgentSdk: true,
      usesCodeServerWorkspace: true,
      claudeProvider: {
        provider: "ccr",
        baseUrlConfigured: true,
        baseUrlSource: "MYCC_CCR_BASE_URL",
        credentialConfigured: true,
        credentialSource: "MYCC_CCR_AUTH_TOKEN",
        credentialTarget: "ANTHROPIC_AUTH_TOKEN",
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B Agent SDK")).toBeInTheDocument();
    expect(screen.getByText("CCR 已配置")).toBeInTheDocument();
    expect(screen.getByText("code-server workspace")).toBeInTheDocument();
    expect(screen.queryByText(/MYCC_CCR/)).not.toBeInTheDocument();
  });
});
