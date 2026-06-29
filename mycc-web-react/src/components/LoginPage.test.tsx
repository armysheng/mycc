import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    login: vi.fn(),
  }),
}));

const authMocks = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  getAuthConfig: authMocks.getAuthConfig,
  login: authMocks.login,
  register: authMocks.register,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getAuthConfig.mockResolvedValue({
      success: true,
      data: {
        registration: {
          mode: "open",
          enabled: true,
          inviteRequired: false,
        },
      },
    });
  });

  it("uses personal-assistant copy without implementation terminology", () => {
    render(<LoginPage />);

    expect(screen.getByText("道友 AI 个人助理")).toBeInTheDocument();
    expect(screen.getByText("念头通达出品 · 问清楚，再动手")).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
  });

  it("does not autofill shared dev credentials by default", () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText("请输入手机号或邮箱")).toHaveValue("");
    expect(screen.getByPlaceholderText("请输入密码")).toHaveValue("");
  });

  it("asks for an invite code when registration is invite-only", async () => {
    authMocks.getAuthConfig.mockResolvedValueOnce({
      success: true,
      data: {
        registration: {
          mode: "invite",
          enabled: true,
          inviteRequired: true,
        },
      },
    });

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByLabelText("内测邀请码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入邀请码")).toBeRequired();
  });

  it("disables registration when the public gate is closed", async () => {
    authMocks.getAuthConfig.mockResolvedValueOnce({
      success: true,
      data: {
        registration: {
          mode: "closed",
          enabled: false,
          inviteRequired: false,
        },
      },
    });

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByText("当前为邀请内测阶段，请联系团队开通账号。")).toBeInTheDocument();
    const optionalContactInputs = screen.getAllByPlaceholderText("选填");
    expect(optionalContactInputs).toHaveLength(2);
    expect(optionalContactInputs[0]).toBeDisabled();
    expect(optionalContactInputs[1]).toBeDisabled();
    expect(screen.getByPlaceholderText("至少 6 位")).toBeDisabled();
    const inviteCodeInput = screen.queryByPlaceholderText("请输入邀请码");
    if (inviteCodeInput) {
      expect(inviteCodeInput).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "邀请内测中" })).toBeDisabled();
  });

  it("does not display internal login errors", async () => {
    authMocks.login.mockResolvedValueOnce({
      success: false,
      error:
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText("请输入手机号或邮箱"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "进入工作空间" }));

    await waitFor(() => {
      expect(screen.getByText("登录失败，请稍后重试")).toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
  });

  it("does not display internal registration errors", async () => {
    authMocks.register.mockResolvedValueOnce({
      success: false,
      error:
        "MyCC E2B sandbox failed for mycc_u_123 token at /home/mycc linuxUser",
    });

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入" }));

    await waitFor(() => {
      expect(screen.getByText("注册失败，请稍后重试")).toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(
      /MyCC|E2B|sandbox|token|mycc_u|linuxUser|\/home\/mycc/i,
    );
  });
});
