import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "../contexts/AuthContext";
import {
  getAuthConfig,
  getCurrentUser,
  login as apiLogin,
  register as apiRegister,
  resolveAuthUrl,
} from "../api/auth";
import { toRetryableUserFacingError } from "../api/userFacingError";
import { PRODUCT_COPY } from "../utils/productCopy";
import type { OAuthProvider, OAuthProviderConfig, RegistrationMode } from "../types/auth";

const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
};

const DEFAULT_OAUTH_PROVIDERS: Record<OAuthProvider, OAuthProviderConfig> = {
  google: {
    enabled: false,
    authUrl: "/api/auth/oauth/google/start",
  },
  github: {
    enabled: false,
    authUrl: "/api/auth/oauth/github/start",
  },
};

function safeReturnPath(value: string | null | undefined): string {
  const path = value?.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/";
  }
  return path;
}

function getCurrentReturnTo(): string {
  if (typeof window === "undefined") return "/";
  const current = `${window.location.pathname}${window.location.search}`;
  if (!current || current === "/login" || current.startsWith("/login?")) {
    return "/";
  }
  return safeReturnPath(current);
}

function withReturnTo(authUrl: string, returnTo: string): string {
  const separator = authUrl.includes("?") ? "&" : "?";
  return `${authUrl}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}

export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const isDev = import.meta.env.DEV;
  const devCredential = isDev ? import.meta.env.VITE_DEV_LOGIN_CREDENTIAL ?? "" : "";
  const devPassword = isDev ? import.meta.env.VITE_DEV_LOGIN_PASSWORD ?? "" : "";
  const [credential, setCredential] = useState(devCredential);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(devPassword);
  const [inviteCode, setInviteCode] = useState("");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>("open");
  const [oauthProviders, setOauthProviders] =
    useState<Record<OAuthProvider, OAuthProviderConfig>>(DEFAULT_OAUTH_PROVIDERS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const registrationClosed = registrationMode === "closed";
  const inviteRequired = registrationMode === "invite";

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((res) => {
        const mode = res.data?.registration.mode;
        if (!cancelled && mode) {
          setRegistrationMode(mode);
        }
        const providers = res.data?.oauth?.providers;
        if (!cancelled && providers) {
          setOauthProviders({
            google: providers.google ?? DEFAULT_OAUTH_PROVIDERS.google,
            github: providers.github ?? DEFAULT_OAUTH_PROVIDERS.github,
          });
        }
      })
      .catch(() => {
        // The backend remains the source of truth if this lightweight config fetch fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash,
    );
    const getOAuthParam = (name: string) => searchParams.get(name) || hashParams.get(name);
    const oauthError = getOAuthParam("oauth_error") || getOAuthParam("auth_error");
    const oauthToken = getOAuthParam("oauth_token") || getOAuthParam("token");
    const returnTo = safeReturnPath(getOAuthParam("return_to"));

    if (oauthError) {
      setError(toRetryableUserFacingError(oauthError, "第三方登录失败"));
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    if (!oauthToken) return;

    setError("");
    setLoading(true);
    getCurrentUser(oauthToken)
      .then((res) => {
        if (res.success && res.data) {
          login(oauthToken, res.data);
          window.history.replaceState(null, "", returnTo);
          return;
        }
        setError(toRetryableUserFacingError(res.error, "第三方登录失败"));
        window.history.replaceState(null, "", window.location.pathname);
      })
      .catch((err) => {
        setError(
          toRetryableUserFacingError(
            err instanceof Error ? err.message : undefined,
            "第三方登录失败",
          ),
        );
        window.history.replaceState(null, "", window.location.pathname);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [login]);

  const clearStaleSessionQuery = () => {
    if (typeof window === "undefined") return;
    if (!window.location.search) return;
    window.history.replaceState(null, "", window.location.pathname);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiLogin({ credential, password });
      if (res.success && res.data) {
        clearStaleSessionQuery();
        login(res.data.token, res.data.user);
      } else {
        setError(toRetryableUserFacingError(res.error, "登录失败"));
      }
    } catch (err) {
      setError(
        toRetryableUserFacingError(
          err instanceof Error ? err.message : undefined,
          "登录失败",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiRegister({
        phone,
        email,
        password,
        ...(inviteRequired ? { inviteCode } : {}),
      });
      if (res.success && res.data) {
        clearStaleSessionQuery();
        login(res.data.token, res.data.user);
      } else {
        setError(toRetryableUserFacingError(res.error, "注册失败"));
      }
    } catch (err) {
      setError(
        toRetryableUserFacingError(
          err instanceof Error ? err.message : undefined,
          "注册失败",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClassName =
    "w-full rounded-xl border bg-[var(--bg-input)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-200 focus:outline-none focus:ring-2";
  const enabledOAuthProviders = (Object.keys(oauthProviders) as OAuthProvider[])
    .filter((provider) => oauthProviders[provider].enabled);
  const oauthReturnTo = getCurrentReturnTo();

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-10">
      <div
        className="absolute inset-0 bg-[var(--bg-base)]"
        style={{
          backgroundImage:
            "linear-gradient(120deg, rgba(18,26,45,0.08) 0 1px, transparent 1px 100%), linear-gradient(0deg, rgba(37,99,235,0.08) 0 1px, transparent 1px 100%)",
          backgroundSize: "52px 52px, 100% 28px",
        }}
      />
      <div className="absolute inset-x-6 top-6 h-px bg-[var(--surface-border)]" />
      <div className="absolute inset-y-6 left-6 w-px bg-[var(--surface-border)]" />
      <div className="absolute inset-x-6 bottom-6 h-px bg-[var(--surface-border)]" />
      <div className="absolute inset-y-6 right-6 w-px bg-[var(--surface-border)]" />

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
        <section
          className="relative hidden overflow-hidden lg:flex flex-col justify-between rounded-[24px] border p-8"
          style={{
            background:
              "linear-gradient(145deg, color-mix(in oklab, var(--bg-surface) 96%, black 4%) 0%, var(--bg-surface) 100%)",
            borderColor: "var(--surface-border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="pointer-events-none absolute -right-8 top-8 text-[164px] font-semibold leading-none text-[var(--text-primary)] opacity-[0.04]">
            道
          </div>
          <div className="relative">
            <div className="inline-flex items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--accent-border)] text-sm font-semibold text-[var(--accent)]">
                问
              </span>
              <span>{PRODUCT_COPY.brandName} 个人助理</span>
            </div>
            <h1
              className="mt-6 max-w-xl text-4xl font-semibold text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              问清楚，再动手。把念头落成结果。
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">
              登录后直接唤起你的专属助理，在个人上下文里使用技能、自动化与长期记忆。
              保持清醒的问题意识，也保持马上推进的执行力。
            </p>
          </div>

          <div className="relative mt-8 grid grid-cols-3 gap-0 border-y border-[var(--surface-border)] text-left">
            <div className="py-4 pr-4">
              <div className="text-xs font-semibold text-[var(--accent)]">01</div>
              <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                问道
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                对齐目标和上下文
              </div>
            </div>
            <div className="border-x border-[var(--surface-border)] px-4 py-4">
              <div className="text-xs font-semibold text-[var(--accent)]">02</div>
              <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                拆解
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                把想法变成步骤
              </div>
            </div>
            <div className="py-4 pl-4">
              <div className="text-xs font-semibold text-[var(--accent)]">03</div>
              <div className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                落地
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                交付文件和结果
              </div>
            </div>
          </div>
        </section>

        <section
          className="rounded-[22px] border p-5 sm:p-7"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--surface-border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="h-10 w-10 rounded-[10px] border flex items-center justify-center text-base font-bold"
              style={{
                borderColor: "var(--accent-border)",
                color: "var(--accent)",
                background: "var(--accent-subtle)",
              }}
            >
              道
            </div>
            <div>
              <div
                className="text-base font-semibold text-[var(--text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {PRODUCT_COPY.brandName}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {PRODUCT_COPY.brandProofLine}
              </div>
            </div>
          </div>

          <div className="mt-6 inline-grid w-full grid-cols-2 rounded-xl border p-1 bg-[var(--bg-elevated)] border-[var(--surface-border)]">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === "login"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === "register"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              注册
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border px-3 py-2.5 text-sm text-red-500 bg-red-500/10 border-red-400/30">
              {error}
            </div>
          )}

          {mode === "register" && registrationClosed && (
            <div className="mt-4 rounded-xl border px-3 py-2.5 text-sm text-[var(--text-secondary)] bg-[var(--accent-subtle)] border-[var(--accent-border)]">
              暂未开放自助注册，请联系团队开通账号。
            </div>
          )}

          {enabledOAuthProviders.length > 0 && (
            <div className="mt-5 space-y-2">
              {enabledOAuthProviders.map((provider) => {
                const config = oauthProviders[provider];
                const label = OAUTH_PROVIDER_LABELS[provider];
                return (
                  <a
                    key={provider}
                    href={withReturnTo(resolveAuthUrl(config.authUrl), oauthReturnTo)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--bg-elevated)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-border)] hover:bg-[var(--accent-subtle)]"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 items-center justify-center rounded-[6px] border border-[var(--surface-border)] text-[10px] font-bold"
                    >
                      {provider === "google" ? "G" : "GH"}
                    </span>
                    使用 {label} 继续
                  </a>
                );
              })}
              <div className="flex items-center gap-3 py-1 text-[11px] text-[var(--text-muted)]">
                <span className="h-px flex-1 bg-[var(--surface-border)]" />
                <span>或使用账号密码</span>
                <span className="h-px flex-1 bg-[var(--surface-border)]" />
              </div>
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="mt-5 space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  手机号 / 邮箱
                </label>
                <input
                  type="text"
                  placeholder="请输入手机号或邮箱"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  密码
                </label>
                <input
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text-inverse)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  background: loading ? "var(--accent-hover)" : "var(--accent)",
                }}
              >
                {loading ? "登录中..." : "进入工作空间"}
                {!loading && <ArrowRightIcon className="h-4 w-4" />}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  手机号
                </label>
                <input
                  type="tel"
                  placeholder="选填"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
                  disabled={registrationClosed}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  邮箱
                </label>
                <input
                  type="email"
                  placeholder="选填"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
                  disabled={registrationClosed}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  密码
                </label>
                <input
                  type="password"
                  placeholder="至少 6 位"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
                  required
                  minLength={6}
                  disabled={registrationClosed}
                />
              </div>
              {inviteRequired && (
                <div>
                  <label
                    htmlFor="invite-code"
                    className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
                  >
                    内测邀请码
                  </label>
                  <input
                    id="invite-code"
                    type="text"
                    placeholder="请输入邀请码"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className={inputClassName}
                    style={{ borderColor: "var(--surface-border)" }}
                    required
                    disabled={registrationClosed}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || registrationClosed}
                className="mt-2 w-full rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text-inverse)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: loading || registrationClosed ? "var(--accent-hover)" : "var(--accent)",
                }}
              >
                {registrationClosed ? "暂未开放注册" : loading ? "注册中..." : "创建并进入"}
              </button>
            </form>
          )}

          <div className="mt-5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <ShieldCheckIcon className="h-4 w-4" />
            你的登录态和个性化设置仅用于当前账号与本地展示。
          </div>
        </section>
      </div>
    </div>
  );
}
