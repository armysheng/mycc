import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  getAuthHeaders,
  getSkillDisableUrl,
  getSkillEnableUrl,
  getSkillInstallUrl,
  getSkillsUrl,
  getSkillUpgradeUrl,
} from "../config/api";

type SkillStatus = "installed" | "available" | "disabled";

interface SkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  status: SkillStatus;
  installed: boolean;
  version: string;
  installedVersion: string | null;
  latestVersion: string;
  source: string;
  legacy: boolean;
  enabled: boolean;
  upgradable: boolean;
}

function isRetryableLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("请求超时") ||
    error.message.includes("连接超时") ||
    error.message.includes("Not connected")
  );
}

export function SkillsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"installed" | "market">("installed");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchJsonWithTimeout = useCallback(
    async (url: string, init?: RequestInit, timeoutMs = 45000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `请求失败: ${res.status} ${res.statusText}`);
        }
        return json;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          throw new Error("请求超时，请稍后重试");
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
    [],
  );

  const loadSkills = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      let json: any = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          json = await fetchJsonWithTimeout(getSkillsUrl(), {
            headers: getAuthHeaders(token),
          });
          break;
        } catch (e) {
          lastError = e;
          if (attempt === 0 && isRetryableLoadError(e)) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            continue;
          }
          throw e;
        }
      }

      if (!json) {
        throw lastError instanceof Error ? lastError : new Error("加载技能失败");
      }
      setSkills((json.data?.skills || []) as SkillItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载技能失败");
    } finally {
      setLoading(false);
    }
  }, [fetchJsonWithTimeout, token]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const callSkillAction = useCallback(
    async (skillId: string, action: "install" | "upgrade" | "enable" | "disable") => {
      if (!token) return;
      setProcessingId(skillId);
      setError(null);
      const urlMap = {
        install: getSkillInstallUrl(skillId),
        upgrade: getSkillUpgradeUrl(skillId),
        enable: getSkillEnableUrl(skillId),
        disable: getSkillDisableUrl(skillId),
      };
      try {
        await fetchJsonWithTimeout(urlMap[action], {
          method: "POST",
          headers: getAuthHeaders(token),
          body: "{}",
        });
        await loadSkills();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${action} 失败`);
      } finally {
        setProcessingId(null);
      }
    },
    [loadSkills, token],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      activeTab === "installed"
        ? skills.filter((s) => s.installed)
        : skills.filter((s) => !s.installed);
    if (!q) return base;
    return base.filter((s) =>
      [s.id, s.name, s.description, s.trigger].join(" ").toLowerCase().includes(q),
    );
  }, [activeTab, query, skills]);

  const installedCount = skills.filter((s) => s.installed).length;
  const marketCount = skills.filter((s) => !s.installed).length;

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={() => navigate("/")}
        currentSection="skills"
        onOpenChat={() => navigate("/")}
        onOpenSkills={() => navigate("/skills")}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 sm:p-8">
          <header className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">Skills</h1>
              <p className="text-slate-500 mt-1">浏览和管理 AI 能力</p>
            </div>
            <button
              type="button"
              onClick={loadSkills}
              className="px-4 py-2 rounded-xl border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              刷新
            </button>
          </header>

          <div className="panel-surface border rounded-2xl p-4 mb-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setActiveTab("installed")}
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  activeTab === "installed"
                    ? "text-[var(--text-inverse)]"
                    : "panel-surface"
                }`}
                style={
                  activeTab === "installed"
                    ? { background: "var(--accent)", borderColor: "var(--accent)" }
                    : undefined
                }
              >
                已安装 ({installedCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("market")}
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  activeTab === "market"
                    ? "text-[var(--text-inverse)]"
                    : "panel-surface"
                }`}
                style={
                  activeTab === "market"
                    ? { background: "var(--accent)", borderColor: "var(--accent)" }
                    : undefined
                }
              >
                市场 ({marketCount})
              </button>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能..."
              className="w-full rounded-xl border px-3 py-2 panel-surface outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              系统错误：{error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-slate-500">加载中...</div>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((skill) => (
                <article key={skill.id} className="panel-surface border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{skill.icon}</span>
                    <h3 className="text-xl font-semibold leading-none">{skill.name}</h3>
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full border">
                      {skill.installed ? "内置/已安装" : "市场"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 min-h-12">{skill.description || "无描述"}</p>
                  <div className="mt-2 text-xs text-slate-500">
                    <div>触发词: <code>{skill.trigger}</code></div>
                    <div>版本: {skill.installedVersion || "-"} / 最新 {skill.latestVersion}</div>
                    <div>来源: {skill.source}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!skill.installed && (
                      <button
                        type="button"
                        onClick={() => callSkillAction(skill.id, "install")}
                        disabled={processingId === skill.id}
                        className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-inverse)] disabled:opacity-60"
                        style={{ background: "var(--accent)" }}
                      >
                        {processingId === skill.id ? "处理中..." : "安装"}
                      </button>
                    )}
                    {skill.installed && (
                      <>
                        <button
                          type="button"
                          onClick={() => navigate("/", { state: { prefill: `${skill.trigger} ` } })}
                          className="px-3 py-1.5 rounded-lg text-sm border panel-surface"
                        >
                          使用
                        </button>
                        {skill.upgradable && (
                          <button
                            type="button"
                            onClick={() => callSkillAction(skill.id, "upgrade")}
                            disabled={processingId === skill.id}
                            className="px-3 py-1.5 rounded-lg text-sm bg-amber-500 text-white disabled:opacity-60"
                          >
                            升级
                          </button>
                        )}
                        {skill.enabled ? (
                          <button
                            type="button"
                            onClick={() => callSkillAction(skill.id, "disable")}
                            disabled={processingId === skill.id}
                            className="px-3 py-1.5 rounded-lg text-sm border"
                          >
                            禁用
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => callSkillAction(skill.id, "enable")}
                            disabled={processingId === skill.id}
                            className="px-3 py-1.5 rounded-lg text-sm border"
                          >
                            启用
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
              {filtered.length === 0 && (
                <div className="text-sm text-slate-500">没有匹配的技能</div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
