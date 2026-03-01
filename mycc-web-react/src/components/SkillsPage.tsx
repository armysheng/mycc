import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  getAuthHeaders,
  getSkillDisableUrl,
  getSkillEnableUrl,
  getSkillInstallUrl,
  getSkillsUrl,
  getSkillsSearchUrl,
  getSkillUninstallUrl,
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
  examplePrompt?: string;
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
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Debounced search
  const [searchResults, setSearchResults] = useState<SkillItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      if (!token) return;
      setSearching(true);
      try {
        const json = await fetchJsonWithTimeout(getSkillsSearchUrl(q), {
          headers: getAuthHeaders(token),
        });
        setSearchResults((json.data || []) as SkillItem[]);
      } catch {
        setSearchResults(null);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, token, fetchJsonWithTimeout]);

  const callSkillAction = useCallback(
    async (skillId: string, action: "install" | "upgrade" | "enable" | "disable" | "uninstall") => {
      if (!token) return;
      if (action === "uninstall" && !window.confirm("确定要卸载该技能吗？")) return;
      setProcessingId(skillId);
      setError(null);
      const urlMap: Record<string, string> = {
        install: getSkillInstallUrl(skillId),
        upgrade: getSkillUpgradeUrl(skillId),
        enable: getSkillEnableUrl(skillId),
        disable: getSkillDisableUrl(skillId),
        uninstall: getSkillUninstallUrl(skillId),
      };
      try {
        await fetchJsonWithTimeout(urlMap[action], {
          method: "POST",
          headers: getAuthHeaders(token),
          body: "{}",
        });
        setSelectedSkill(null);
        await loadSkills();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${action} 失败`);
      } finally {
        setProcessingId(null);
      }
    },
    [fetchJsonWithTimeout, loadSkills, token],
  );

  // Split skills into sections
  const { installed, recommended, searchList } = useMemo(() => {
    if (searchResults) {
      return { installed: [], recommended: [], searchList: searchResults };
    }
    const inst = skills.filter((s) => s.installed);
    const rec = skills.filter((s) => !s.installed);
    return { installed: inst, recommended: rec, searchList: null };
  }, [skills, searchResults]);

  const isSearching = searchResults !== null || searching;

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={() => navigate("/")}
        isOpen={false}
        onClose={() => {}}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 sm:p-8">
          {/* Header */}
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">技能</h1>
            <button
              type="button"
              onClick={loadSkills}
              disabled={loading}
              className="p-2 rounded-lg border panel-surface text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50"
              title="刷新"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>
            </button>
          </header>

          {/* Search */}
          <div className="mb-6">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能..."
              className="w-full rounded-xl border px-4 py-2.5 panel-surface outline-none focus:ring-2 focus:ring-[var(--accent)]/35 text-sm"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-[var(--text-secondary)] py-12 text-center">加载中...</div>
          ) : searching ? (
            <div className="text-sm text-[var(--text-secondary)] py-12 text-center">搜索中...</div>
          ) : isSearching && searchList ? (
            /* Search results — flat list */
            <section>
              <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                搜索结果 ({searchList.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {searchList.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    processingId={processingId}
                    onAction={callSkillAction}
                    onSelect={setSelectedSkill}
                  />
                ))}
              </div>
              {searchList.length === 0 && (
                <div className="text-sm text-[var(--text-secondary)] py-8 text-center">没有匹配的技能</div>
              )}
            </section>
          ) : (
            <>
              {/* Installed section */}
              <section className="mb-8">
                <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                  已安装 ({installed.length})
                </h2>
                {installed.length === 0 ? (
                  <div className="text-sm text-[var(--text-secondary)] py-4">暂无已安装技能</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {installed.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        processingId={processingId}
                        onAction={callSkillAction}
                        onSelect={setSelectedSkill}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Recommended section */}
              <section>
                <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                  推荐 ({recommended.length})
                </h2>
                {recommended.length === 0 ? (
                  <div className="text-sm text-[var(--text-secondary)] py-4">所有技能已安装</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recommended.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        processingId={processingId}
                        onAction={callSkillAction}
                        onSelect={setSelectedSkill}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Detail modal */}
      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          processingId={processingId}
          onClose={() => setSelectedSkill(null)}
          onAction={callSkillAction}
          onTry={(trigger) => {
            setSelectedSkill(null);
            navigate("/", { state: { prefill: `${trigger} ` } });
          }}
        />
      )}
    </div>
  );
}

/* ── Skill Card ── */

function SkillCard({
  skill,
  processingId,
  onAction,
  onSelect,
}: {
  skill: SkillItem;
  processingId: string | null;
  onAction: (id: string, action: "install" | "enable" | "disable") => void;
  onSelect: (skill: SkillItem) => void;
}) {
  const busy = processingId === skill.id;

  return (
    <article
      className="panel-surface border rounded-xl p-3.5 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-3"
      onClick={() => onSelect(skill)}
    >
      <span className="text-2xl shrink-0">{skill.icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold truncate text-[var(--text-primary)]">{skill.name}</h3>
        <p className="text-xs text-[var(--text-secondary)] truncate">{skill.description}</p>
      </div>
      {/* Action area */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        {skill.installed ? (
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={skill.enabled}
              disabled={busy}
              onChange={() => onAction(skill.id, skill.enabled ? "disable" : "enable")}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:bg-[var(--accent)] transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        ) : (
          <button
            type="button"
            onClick={() => onAction(skill.id, "install")}
            disabled={busy}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-lg leading-none disabled:opacity-50"
            style={{ background: "var(--accent)" }}
            title="安装"
          >
            +
          </button>
        )}
      </div>
    </article>
  );
}

/* ── Detail Modal ── */

function SkillDetailModal({
  skill,
  processingId,
  onClose,
  onAction,
  onTry,
}: {
  skill: SkillItem;
  processingId: string | null;
  onClose: () => void;
  onAction: (id: string, action: "install" | "uninstall" | "enable" | "disable") => void;
  onTry: (trigger: string) => void;
}) {
  const busy = processingId === skill.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="panel-surface border rounded-2xl w-full max-w-md mx-4 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{skill.icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{skill.name}</h2>
            <span className="text-xs text-[var(--text-secondary)]">v{skill.version}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Description */}
        <p className="text-sm text-[var(--text-secondary)] mb-4">{skill.description}</p>

        {/* Meta */}
        <div className="space-y-2 mb-5 text-xs text-[var(--text-secondary)]">
          <div className="flex justify-between">
            <span>触发词</span>
            <code className="bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">{skill.trigger}</code>
          </div>
          {skill.examplePrompt && (
            <div className="flex justify-between gap-2">
              <span className="shrink-0">示例</span>
              <span className="text-right truncate">{skill.examplePrompt}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>来源</span>
            <span>{skill.source}</span>
          </div>
          <div className="flex justify-between">
            <span>状态</span>
            <span>{skill.installed ? (skill.enabled ? "已启用" : "已禁用") : "未安装"}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {skill.installed ? (
            <>
              <button
                type="button"
                onClick={() => onTry(skill.trigger)}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                试用
              </button>
              <button
                type="button"
                onClick={() => onAction(skill.id, skill.enabled ? "disable" : "enable")}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm border panel-surface disabled:opacity-50"
              >
                {busy ? "处理中..." : skill.enabled ? "禁用" : "启用"}
              </button>
              <button
                type="button"
                onClick={() => onAction(skill.id, "uninstall")}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                卸载
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onAction(skill.id, "install")}
              disabled={busy}
              className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {busy ? "安装中..." : "安装"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
