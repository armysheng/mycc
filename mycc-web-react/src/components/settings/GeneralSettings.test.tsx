import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    autoExpandThinking: false,
    enterBehavior: "send",
    fontSize: "medium",
    showToolCalls: false,
    theme: "light",
    setFontSize: vi.fn(),
    toggleAutoExpandThinking: vi.fn(),
    toggleEnterBehavior: vi.fn(),
    toggleShowToolCalls: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    token: "test-token",
    user: {
      assistant_name: "小麦",
      email: "tester@example.com",
      id: 42,
      plan: "basic",
      is_initialized: true,
    },
  }),
}));

vi.mock("../../api/auth", () => ({
  updateProfile: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  getBillingSubscription: vi.fn(async () => ({
    cny_per_1k_tokens: 0.02,
    monthly_price_cny: 19,
    plan: "basic",
    plan_name: "基础版",
    reset_at: "2026-06-01T00:00:00.000Z",
    tokens_limit: 100000,
    tokens_remaining: 95000,
    tokens_used: 5000,
    usage_percentage: 5,
  })),
  getBillingPlans: vi.fn(async () => ({
    plans: [
      {
        can_upgrade: false,
        cny_per_1k_tokens: 0.02,
        description: "100000 tokens included",
        estimated_deep_tasks: 20,
        highlights: ["More tokens for longer tasks"],
        id: "basic",
        is_current: true,
        is_recommended: false,
        monthly_price_cny: 19,
        name: "基础版",
        tokens_limit: 100000,
        tokens_per_cny: 5263,
      },
    ],
    recommendation: {
      plan: "basic",
      reason: "Your token usage is healthy",
    },
  })),
  upgradePlan: vi.fn(),
}));

describe("GeneralSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps billing copy user-facing without token terminology", async () => {
    render(<GeneralSettings />);

    await waitFor(() => {
      expect(screen.getByText("当前套餐：基础版")).toBeInTheDocument();
    });

    expect(screen.queryByText(/\btokens?\b/i)).not.toBeInTheDocument();
    expect(screen.getByText("tester@example.com")).toBeInTheDocument();
    expect(screen.getByText("助手：小麦")).toBeInTheDocument();
    expect(screen.queryByText("tester")).not.toBeInTheDocument();
    expect(screen.queryByText("local-user")).not.toBeInTheDocument();
  });
});
