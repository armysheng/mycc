import { useState } from "react";
import {
  ArrowRightIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "../contexts/AuthContext";
import { login as apiLogin, register as apiRegister } from "../api/auth";

export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const isDev = import.meta.env.DEV;
  const [credential, setCredential] = useState(isDev ? "+8613800138000" : "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState(isDev ? "test123456" : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiLogin({ credential, password });
      if (res.success && res.data) {
        login(res.data.token, res.data.user);
      } else {
        setError(res.error || "登录失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiRegister({ phone, email, password, nickname });
      if (res.success && res.data) {
        login(res.data.token, res.data.user);
      } else {
        setError(res.error || "注册失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  const inputClassName =
    "w-full rounded-xl border bg-[var(--bg-input)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-200 focus:outline-none focus:ring-2";

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-10">
      <div className="absolute inset-0 bg-[var(--bg-base)]" />
      <div
        className="absolute -top-32 -left-20 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: "var(--accent-subtle)" }}
      />
      <div
        className="absolute -bottom-24 -right-20 h-80 w-80 rounded-full opacity-35 blur-3xl"
        style={{ background: "rgba(59,130,246,0.16)" }}
      />

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
        <section
          className="hidden lg:flex flex-col justify-between rounded-[24px] border p-8"
          style={{
            background:
              "linear-gradient(145deg, color-mix(in oklab, var(--bg-surface) 92%, black 8%) 0%, var(--bg-surface) 100%)",
            borderColor: "var(--surface-border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-[var(--text-secondary)]">
              <SparklesIcon className="h-4 w-4" />
              MyCC Personal Workspace
            </div>
            <h1
              className="mt-6 text-4xl font-semibold tracking-tight text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              让每个用户都拥有自己的 Claude 工作空间
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">
              登录后可直接进入多用户会话系统，在你的专属上下文里使用技能、自动化与会话管理能力。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-8">
            <div className="rounded-xl border p-3">
              <div className="text-lg font-semibold text-[var(--text-primary)]">多用户</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">会话与工作区隔离</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-lg font-semibold text-[var(--text-primary)]">技能化</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">工具能力可配置</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-lg font-semibold text-[var(--text-primary)]">可运营</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">额度与权限策略</div>
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
              className="h-9 w-9 rounded-[10px] text-white flex items-center justify-center text-[13px] font-bold"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)",
              }}
            >
              cc
            </div>
            <div>
              <div
                className="text-base font-semibold text-[var(--text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                MyCC
              </div>
              <div className="text-xs text-[var(--text-muted)]">你的多用户助手入口</div>
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
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  昵称
                </label>
                <input
                  type="text"
                  placeholder="用于页面展示"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className={inputClassName}
                  style={{ borderColor: "var(--surface-border)" }}
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
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text-inverse)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: loading ? "var(--accent-hover)" : "var(--accent)",
                }}
              >
                {loading ? "注册中..." : "创建并进入"}
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
