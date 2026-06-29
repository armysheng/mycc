import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    login: vi.fn(),
  }),
}));

vi.mock("../api/auth", () => ({
  login: vi.fn(),
  register: vi.fn(),
}));

describe("LoginPage", () => {
  it("uses personal-assistant copy without implementation terminology", () => {
    render(<LoginPage />);

    expect(screen.getByText("道友 AI 个人助理")).toBeInTheDocument();
    expect(screen.getByText("念头通达出品 · 问清楚，再动手")).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });
});
