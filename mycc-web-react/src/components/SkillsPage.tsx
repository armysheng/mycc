import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  disableSkill,
  enableSkill,
  installSkill,
  listSkills,
  uninstallSkill,
  updateSkill,
  useSkill,
  type SkillActionResult,
  type SkillInstallResult,
  type SkillItem,
} from "../api/skills";

function isRetryableLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("请求超时") ||
    error.message.includes("连接超时") ||
    error.message.includes("Not connected")
  );
}

function sourceLabel(source: string) {
  if (source === "catalog") return "MyCC catalog";
  if (source === "registry") return "MyCC registry";
  if (source === "user") return "用户安装";
  return source || "未知来源";
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      let data = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          data = await listSkills(token);
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

      if (!data) {
        throw lastError instanceof Error ? lastError : new Error("加载技能失败");
      }
      setSkills(data.skills || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载技能失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const callSkillAction = useCallback(
    async (skillId: string, action: "install" | "upgrade" | "enable" | "disable" | "uninstall") => {
      if (!token) return;
      if (action === "uninstall" && !window.confirm("确定要卸载该技能吗？")) return;
      setProcessingId(skillId);
      setError(null);
      setActionMessage(null);
      try {
        let result: SkillActionResult | SkillInstallResult;
        if (action === "install") {
          result = await installSkill(token, skillId);
        } else if (action === "upgrade") {
          result = await updateSkill(token, skillId);
        } else if (action === "enable") {
          result = await enableSkill(token, skillId);
        } else if (action === "disable") {
          result = await disableSkill(token, skillId);
        } else {
          result = await uninstallSkill(token, skillId);
        }

        if ((action === "install" || action === "upgrade") && result.targetPath) {
          setActionMessage(
            `${action === "install" ? "已安装" : "已更新"}到 ${result.targetPath}`,
          );
        }
        await loadSkills();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${action} 失败`);
      } finally {
        setProcessingId(null);
      }
    },
    [loadSkills, token],
  );

  const handleUseSkill = useCallback(
    async (skill: SkillItem) => {
      if (token) {
        try {
          await useSkill(token, skill.id);
        } catch {
          // 使用埋点失败不阻断跳转，用户的主动作是进入聊天试用。
        }
      }
      navigate("/", { state: { prefill: `${skill.trigger} ` } });
    },
    [navigate, token],
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
        isOpen={false}
        onClose={() => {}}
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
          {actionMessage && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
              {actionMessage}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-slate-500">加载中...</div>
          ) : (
            activeTab === "installed" ? (
              <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((skill) => (
                  <article key={skill.id} className="panel-surface border rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{skill.icon}</span>
                      <h3 className="text-xl font-semibold leading-none">{skill.name}</h3>
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full border">
                        已安装
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 min-h-12">{skill.description || "无描述"}</p>
                    <div className="mt-2 text-xs text-slate-500">
                      <div>触发词: <code>{skill.trigger}</code></div>
                      <div>来源: {sourceLabel(skill.source)}</div>
                      <div>版本: {skill.installedVersion || "-"} / 最新 {skill.latestVersion}</div>
                      <div>
                        下载 {skill.stats?.downloads ?? 0} · 使用 {skill.stats?.uses ?? 0}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUseSkill(skill)}
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
                          {processingId === skill.id ? "更新中..." : "更新"}
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
                      <button
                        type="button"
                        onClick={() => callSkillAction(skill.id, "uninstall")}
                        disabled={processingId === skill.id}
                        className="px-3 py-1.5 rounded-lg text-sm border text-red-600 border-red-200 dark:text-red-400 dark:border-red-800"
                      >
                        卸载
                      </button>
                    </div>
                  </article>
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm text-slate-500">没有匹配的技能</div>
                )}
              </section>
            ) : (
              <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((skill) => (
                  <article key={skill.id} className="panel-surface border rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{skill.icon}</span>
                      <h3 className="text-xl font-semibold leading-none">{skill.name}</h3>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 min-h-12">
                      {skill.description || "无描述"}
                    </p>
                    <div className="mt-2 text-xs text-slate-500">
                      <div>触发词: <code>{skill.trigger}</code></div>
                      <div>来源: {sourceLabel(skill.source)}</div>
                      <div>版本: {skill.latestVersion || skill.version}</div>
                      <div>
                        下载 {skill.stats?.downloads ?? 0} · 使用 {skill.stats?.uses ?? 0}
                      </div>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => callSkillAction(skill.id, "install")}
                        disabled={processingId === skill.id}
                        className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-inverse)] disabled:opacity-60"
                        style={{ background: "var(--accent)" }}
                      >
                        {processingId === skill.id ? "安装中..." : "安装"}
                      </button>
                    </div>
                  </article>
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm text-slate-500">没有可安装的技能</div>
                )}
              </section>
            )
          )}
        </div>
      </main>
    </div>
  );
}
