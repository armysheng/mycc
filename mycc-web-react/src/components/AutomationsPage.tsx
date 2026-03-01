import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import { getAutomationsUrl, getAuthHeaders } from "../config/api";

type AutomationStatus = "healthy" | "paused" | "error";

type AutomationType = "daily" | "weekly" | "once" | "interval";

interface AutomationItem {
  id: string;
  name: string;
  scheduleText: string;
  skill: string;
  description: string;
  status: AutomationStatus;
  enabled: boolean;
  type: AutomationType;
}

function statusLabel(status: AutomationStatus): string {
  if (status === "healthy") return "运行中";
  if (status === "paused") return "已暂停";
  return "异常";
}

function statusColorClass(status: AutomationStatus): string {
  if (status === "healthy") return "text-emerald-600 border-emerald-200 bg-emerald-50";
  if (status === "paused") return "text-slate-600 border-slate-200 bg-slate-100";
  return "text-red-600 border-red-200 bg-red-50";
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [items, setItems] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadAutomations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getAutomationsUrl(), {
        headers: getAuthHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "加载自动化任务失败");
      }
      setItems((json?.data?.automations || []) as AutomationItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载自动化任务失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.scheduleText, item.skill, item.description]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [items, query]);

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar onNewChat={() => navigate("/")} isOpen={false} onClose={() => {}} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 sm:p-8">
          <header className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">自动化</h1>
              <p className="text-slate-500 mt-1">查看和管理你的计划任务</p>
            </div>
            <button
              type="button"
              onClick={loadAutomations}
              className="px-4 py-2 rounded-xl border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              刷新
            </button>
          </header>

          <div className="panel-surface border rounded-2xl p-4 mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索自动化任务..."
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
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border panel-surface p-8 text-center text-slate-500 text-sm">
              暂无自动化任务
            </div>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((item) => (
                <article key={item.id} className="panel-surface border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold leading-none truncate">{item.name}</h3>
                    <span
                      className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${statusColorClass(item.status)}`}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-300 min-h-12">
                    {item.description || "无描述"}
                  </p>

                  <div className="mt-2 text-xs text-slate-500 space-y-1">
                    <div>计划: {item.scheduleText}</div>
                    <div>技能: {item.skill || "-"}</div>
                    <div>类型: {item.type}</div>
                    <div>状态: {item.enabled ? "启用" : "禁用"}</div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
