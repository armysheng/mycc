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

  it("lists non-ok E2B preflight gaps without exposing secret values", async () => {
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
        warnCount: 1,
        skipCount: 0,
        checks: [
          {
            id: "e2b-api-key",
            label: "E2B API key",
            status: "error",
            message: "Missing MYCC_E2B_API_KEY or E2B_API_KEY.",
            action: "Create an API key in the E2B dashboard, then set MYCC_E2B_API_KEY.",
            tokenPreview: "e2b_live_secret_123456",
          },
          {
            id: "claude-provider",
            label: "Claude Provider",
            status: "warn",
            message: "CCR provider URL is configured from MYCC_CCR_BASE_URL.",
            action: "Confirm MYCC_CCR_BASE_URL points at your provider before enabling E2B.",
            providerUrl: "https://provider.example.com/secret-route",
          },
          {
            id: "workspace-ready",
            label: "Workspace",
            status: "ok",
            message: "Workspace is ready.",
            action: "No action needed.",
          },
        ],
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B 缺配置 1")).toBeInTheDocument();
    expect(screen.getByText("E2B preflight 缺口")).toBeInTheDocument();
    expect(screen.getByText("E2B API key")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("Missing MYCC_E2B_API_KEY or E2B_API_KEY.")).toBeInTheDocument();
    expect(screen.getByText("Create an API key in the E2B dashboard, then set MYCC_E2B_API_KEY.")).toBeInTheDocument();
    expect(screen.getByText("Claude Provider")).toBeInTheDocument();
    expect(screen.getByText("warn")).toBeInTheDocument();
    expect(screen.getByText("CCR provider URL is configured from MYCC_CCR_BASE_URL.")).toBeInTheDocument();
    expect(screen.getByText("Confirm MYCC_CCR_BASE_URL points at your provider before enabling E2B.")).toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText(/e2b_live_secret_123456/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider\.example\.com/)).not.toBeInTheDocument();
  });

  it("does not surface skipped E2B checks as product-facing gaps", async () => {
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
        checks: [
          {
            id: "e2b-template-exists",
            label: "E2B template",
            status: "skip",
            message: "Remote template existence was not checked.",
            action: "Run npm run doctor:e2b-agent to query E2B for the template.",
          },
        ],
      },
    }) as Response);

    render(<ChatRuntimeStatusBadge token="test-token" />);

    expect(await screen.findByText("E2B 就绪")).toBeInTheDocument();
    expect(screen.queryByText("E2B preflight 缺口")).not.toBeInTheDocument();
    expect(screen.queryByText("E2B template")).not.toBeInTheDocument();
    expect(screen.queryByText(/doctor:e2b-agent/)).not.toBeInTheDocument();
  });
});
