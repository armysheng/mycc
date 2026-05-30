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
      e2bAgentPreflight: {
        ok: true,
        errorCount: 0,
        warnCount: 0,
        checks: [],
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B Agent SDK")).toBeInTheDocument();
    expect(screen.getByText("CCR 已配置")).toBeInTheDocument();
    expect(screen.getByText("code-server workspace")).toBeInTheDocument();
    expect(screen.getByText("E2B 就绪")).toBeInTheDocument();
    expect(screen.queryByText(/MYCC_CCR/)).not.toBeInTheDocument();
  });

  it("shows E2B preflight gaps in the runtime badges", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({
      kind: "e2b-claude-agent-sdk",
      executionEnvironment: "e2b",
      usesAgentSdk: true,
      usesCodeServerWorkspace: true,
      claudeProvider: {
        provider: "anthropic",
        baseUrlConfigured: false,
        credentialConfigured: true,
      },
      e2bAgentPreflight: {
        ok: false,
        errorCount: 1,
        warnCount: 2,
        skipCount: 0,
        checks: [
          {
            id: "e2b-api-key",
            label: "E2B API key",
            status: "error",
            message: "Missing MYCC_E2B_API_KEY or E2B_API_KEY.",
          },
        ],
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B 缺配置 1")).toBeInTheDocument();
    expect(screen.queryByText(/MYCC_E2B_API_KEY/)).not.toBeInTheDocument();
  });

  it("treats skipped E2B checks as pending confirmation", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({
      kind: "e2b-claude-agent-sdk",
      executionEnvironment: "e2b",
      usesAgentSdk: true,
      usesCodeServerWorkspace: true,
      claudeProvider: {
        provider: "ccr",
        baseUrlConfigured: true,
        credentialConfigured: true,
      },
      e2bAgentPreflight: {
        ok: false,
        errorCount: 0,
        warnCount: 0,
        skipCount: 1,
        checks: [],
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B 待确认 1")).toBeInTheDocument();
  });
});
