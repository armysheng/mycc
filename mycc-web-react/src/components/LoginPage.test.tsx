import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const FORBIDDEN_PRODUCT_TERMS =
  /E2B|CCR|Agent SDK|code-server|GNU|sandbox|沙盒|Claude Code|Claude 工作空间|base url|tokens?|sessions?/i;

const authContextMocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    login: authContextMocks.login,
  }),
}));

const authMocks = vi.hoisted(() => ({
  exchangeOAuthLoginCode: vi.fn(),
  getCurrentUser: vi.fn(),
  getAuthConfig: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  exchangeOAuthLoginCode: authMocks.exchangeOAuthLoginCode,
  getCurrentUser: authMocks.getCurrentUser,
  getAuthConfig: authMocks.getAuthConfig,
  login: authMocks.login,
  register: authMocks.register,
  resolveAuthUrl: (pathOrUrl: string) => pathOrUrl,
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
        oauth: {
          providers: {
            google: {
              enabled: false,
              authUrl: "/api/auth/oauth/google/start",
            },
            github: {
              enabled: false,
              authUrl: "/api/auth/oauth/github/start",
            },
          },
        },
      },
    });
    window.history.replaceState(null, "", "/login");
  });

  it("uses personal-assistant copy without implementation terminology", async () => {
    render(<LoginPage />);

    expect(screen.getByText("道友 AI 个人助理")).toBeInTheDocument();
    expect(screen.getByText("念头通达出品 · 问清楚，再动手")).toBeInTheDocument();
    expect(screen.queryByText(FORBIDDEN_PRODUCT_TERMS)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(authMocks.getAuthConfig).toHaveBeenCalledTimes(1);
    });
  });

  it("does not autofill shared dev credentials by default", async () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText("请输入手机号或邮箱")).toHaveValue("");
    expect(screen.getByPlaceholderText("请输入密码")).toHaveValue("");
    await waitFor(() => {
      expect(authMocks.getAuthConfig).toHaveBeenCalledTimes(1);
    });
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
        oauth: {
          providers: {
            google: {
              enabled: false,
              authUrl: "/api/auth/oauth/google/start",
            },
            github: {
              enabled: false,
              authUrl: "/api/auth/oauth/github/start",
            },
          },
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
        oauth: {
          providers: {
            google: {
              enabled: false,
              authUrl: "/api/auth/oauth/google/start",
            },
            github: {
              enabled: false,
              authUrl: "/api/auth/oauth/github/start",
            },
          },
        },
      },
    });

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByText("暂未开放自助注册，请联系团队开通账号。")).toBeInTheDocument();
    const optionalContactInputs = screen.getAllByPlaceholderText("选填");
    expect(optionalContactInputs).toHaveLength(2);
    expect(optionalContactInputs[0]).toBeDisabled();
    expect(optionalContactInputs[1]).toBeDisabled();
    expect(screen.getByPlaceholderText("至少 6 位")).toBeDisabled();
    const inviteCodeInput = screen.queryByPlaceholderText("请输入邀请码");
    if (inviteCodeInput) {
      expect(inviteCodeInput).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "暂未开放注册" })).toBeDisabled();
    expect(document.body).not.toHaveTextContent("邀请内测中");
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

  it("shows enabled OAuth providers with return path links", async () => {
    window.history.replaceState(null, "", "/projects/demo?tab=chat");
    authMocks.getAuthConfig.mockResolvedValueOnce({
      success: true,
      data: {
        registration: {
          mode: "open",
          enabled: true,
          inviteRequired: false,
        },
        oauth: {
          providers: {
            google: {
              enabled: true,
              authUrl: "/api/auth/oauth/google/start",
            },
            github: {
              enabled: true,
              authUrl: "/api/auth/oauth/github/start",
            },
          },
        },
      },
    });

    render(<LoginPage />);

    const googleLink = await screen.findByRole("link", { name: "使用 Google 继续" });
    const githubLink = screen.getByRole("link", { name: "使用 GitHub 继续" });
    expect(googleLink).toHaveAttribute(
      "href",
      "/api/auth/oauth/google/start?returnTo=%2Fprojects%2Fdemo%3Ftab%3Dchat",
    );
    expect(githubLink).toHaveAttribute(
      "href",
      "/api/auth/oauth/github/start?returnTo=%2Fprojects%2Fdemo%3Ftab%3Dchat",
    );
  });

  it("exchanges an OAuth callback code and clears it from the URL before login", async () => {
    window.history.replaceState(
      null,
      "",
      "/login#oauth_code=one-time-code&return_to=%2Fprojects%2Fdemo",
    );
    authMocks.exchangeOAuthLoginCode.mockResolvedValueOnce({
      success: true,
      data: {
        token: "oauth.jwt.token",
        user: {
          id: 9,
          email: "oauth@example.test",
          plan: "free",
          is_initialized: true,
        },
      },
    });

    render(<LoginPage />);

    expect(window.location.hash).not.toContain("one-time-code");

    await waitFor(() => {
      expect(authContextMocks.login).toHaveBeenCalledWith("oauth.jwt.token", {
        id: 9,
        email: "oauth@example.test",
        plan: "free",
        is_initialized: true,
      });
    });
    expect(window.location.pathname).toBe("/projects/demo");
    expect(window.location.search).not.toContain("oauth_code");
    expect(window.location.hash).not.toContain("oauth_code");
    expect(authMocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("does not accept OAuth JWTs directly from the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/login?token=oauth.jwt.token#oauth_token=oauth.jwt.token",
    );

    render(<LoginPage />);

    await waitFor(() => {
      expect(authMocks.getAuthConfig).toHaveBeenCalledTimes(1);
    });
    expect(authContextMocks.login).not.toHaveBeenCalled();
    expect(authMocks.getCurrentUser).not.toHaveBeenCalled();
    expect(authMocks.exchangeOAuthLoginCode).not.toHaveBeenCalled();
  });

  it("shows a product-facing OAuth callback error without leaking query details", async () => {
    window.history.replaceState(
      null,
      "",
      "/login#oauth_error=GitHub%20failed%20with%20client_secret%20at%20%2Ftmp%2Ftoken",
    );

    render(<LoginPage />);

    expect(await screen.findByText("第三方登录失败，请稍后重试")).toBeInTheDocument();
    expect(window.location.search).not.toContain("client_secret");
    expect(document.body).not.toHaveTextContent(/client_secret|\/tmp\/token/i);
  });
});
