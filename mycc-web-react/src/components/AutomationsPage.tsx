import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "./layout/Sidebar";
import { useAuth } from "../contexts/AuthContext";
import {
  getAutomationsUrl,
  getAutomationDeleteUrl,
  getAutomationDisableUrl,
  getAutomationEnableUrl,
  getAutomationRunUrl,
  getAuthHeaders,
} from "../config/api";

type AutomationStatus = "healthy" | "paused" | "error";
type AutomationType = "daily" | "weekly" | "once" | "interval" | "cron";

interface AutomationTrigger {
  type: "cron" | "manual";
  cron?: string;
  timezone?: string;
}

interface AutomationExecution {
  type: "skill";
  skill: string;
  prompt: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: "success" | "failed" | null;
  lastError: string | null;
}

interface AutomationDelivery {
  type: "inbox";
  enabled: boolean;
}

interface AutomationItem {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  enabled: boolean;
  type: AutomationType;
  scheduleText: string;
  trigger: AutomationTrigger;
  execution: AutomationExecution;
  delivery: AutomationDelivery;
}

interface CreateTemplate {
  id: string;
  label: string;
  name: string;
  cron: string;
  skill: string;
  description: string;
  prompt: string;
}

interface CreateDraft {
  templateId: string;
  name: string;
  cron: string;
  skill: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

const CREATE_TEMPLATES: CreateTemplate[] = [
  {
    id: "daily-brief",
    label: "每日简报",
    name: "每日简报",
    cron: "09:00",
    skill: "/tell-me",
    description: "每天自动生成工作简报",
    prompt: "请总结昨天完成项、今天计划和风险提醒。",
  },
  {
    id: "weekly-review",
    label: "每周复盘",
    name: "每周复盘",
    cron: "周五 18:30",
    skill: "/tell-me",
    description: "每周五生成本周复盘摘要",
    prompt: "请回顾本周目标达成情况，并给出下周建议。",
  },
  {
    id: "health-check",
    label: "健康巡检",
    name: "系统健康巡检",
    cron: "每2小时",
    skill: "/mycc-regression",
    description: "巡检核心链路并输出状态",
    prompt: "执行健康检查并输出异常项、影响范围和建议动作。",
  },
];

function statusLabel(status: AutomationStatus): string {
  if (status === "healthy") return "运行中";
  if (status === "paused") return "已暂停";
  return "异常";
}

function statusColorClass(status: AutomationStatus): string {
  if (status === "healthy") return "text-emerald-700 border-emerald-200 bg-emerald-50";
  if (status === "paused") return "text-slate-700 border-slate-200 bg-slate-100";
  return "text-red-700 border-red-200 bg-red-50";
}

function buildDraft(templateId = CREATE_TEMPLATES[0].id): CreateDraft {
  const template = CREATE_TEMPLATES.find((item) => item.id === templateId) || CREATE_TEMPLATES[0];
  return {
    templateId: template.id,
    name: template.name,
    cron: template.cron,
    skill: template.skill,
    description: template.description,
    prompt: template.prompt,
    enabled: true,
  };
}

function formatTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeList(payload: any): AutomationItem[] {
  return (payload?.data?.automations || []) as AutomationItem[];
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [items, setItems] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => buildDraft());
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const apiFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!token) {
      throw new Error("登录状态失效，请重新登录");
    }
    const res = await fetch(url, {
      ...init,
      headers: getAuthHeaders(token),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      throw new Error(json?.error || "请求失败");
    }
    return json;
  }, [token]);

  const loadAutomations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch(getAutomationsUrl());
      setItems(normalizeList(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载自动化任务失败");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, token]);

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.scheduleText, item.execution?.skill, item.description]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [items, query]);

  const handleTemplateChange = (templateId: string) => {
    setCreateDraft(buildDraft(templateId));
  };

  const openCreate = () => {
    setCreateDraft(buildDraft());
    setCreateOpen(true);
    setNotice(null);
  };

  const handleCreate = async () => {
    const name = createDraft.name.trim();
    const cron = createDraft.cron.trim();
    if (!name || !cron) {
      setError("任务名和时间表达式不能为空");
      return;
    }

    setSubmittingCreate(true);
    setError(null);
    try {
      await apiFetch(getAutomationsUrl(), {
        method: "POST",
        body: JSON.stringify({
          name,
          description: createDraft.description.trim(),
          enabled: createDraft.enabled,
          trigger: {
            type: "cron",
            cron,
            timezone: "Asia/Shanghai",
          },
          execution: {
            type: "skill",
            skill: createDraft.skill.trim() || "-",
            prompt: createDraft.prompt.trim(),
          },
          delivery: {
            type: "inbox",
            enabled: true,
          },
        }),
      });
      setCreateOpen(false);
      setNotice("自动化任务已创建");
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建自动化任务失败");
    } finally {
      setSubmittingCreate(false);
    }
  };

  const runAction = async (id: string, action: "enable" | "disable" | "run" | "delete") => {
    setActingId(id);
    setError(null);
    setNotice(null);
    try {
      if (action === "enable") {
        await apiFetch(getAutomationEnableUrl(id), { method: "POST" });
        setNotice("任务已启用");
      } else if (action === "disable") {
        await apiFetch(getAutomationDisableUrl(id), { method: "POST" });
        setNotice("任务已暂停");
      } else if (action === "run") {
        const json = await apiFetch(getAutomationRunUrl(id), { method: "POST" });
        setNotice(`已立即执行：${formatTime(json?.data?.run?.executedAt || null)}`);
      } else {
        const ok = window.confirm("确认删除该自动化任务？删除后不可恢复。");
        if (!ok) return;
        await apiFetch(getAutomationDeleteUrl(id), { method: "DELETE" });
        setNotice("任务已删除");
      }
      await loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar onNewChat={() => navigate("/")} isOpen={false} onClose={() => {}} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">自动化</h1>
              <p className="text-slate-500 mt-1">OpenClaw V1：模板创建、状态控制、立即运行</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadAutomations}
                className="px-4 py-2 rounded-xl border panel-surface text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                + 新建自动化
              </button>
            </div>
          </header>

          <div className="panel-surface border rounded-2xl p-4 mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索任务名、计划、skill 或描述..."
              className="w-full rounded-xl border px-3 py-2 panel-surface outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              系统错误：{error}
            </div>
          )}
          {notice && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
              {notice}
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
                    <div>触发: {item.trigger?.cron || "手动"}</div>
                    <div>技能: {item.execution?.skill || "-"}</div>
                    <div>启用: {item.enabled ? "是" : "否"}</div>
                    <div>执行次数: {item.execution?.runCount ?? 0}</div>
                    <div>最近执行: {formatTime(item.execution?.lastRunAt ?? null)}</div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => runAction(item.id, "run")}
                      disabled={actingId === item.id}
                      className="rounded-lg border px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      立即运行
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(item.id, item.enabled ? "disable" : "enable")}
                      disabled={actingId === item.id}
                      className="rounded-lg border px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {item.enabled ? "暂停" : "启用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(item.id, "delete")}
                      disabled={actingId === item.id}
                      className="rounded-lg border border-red-200 text-red-600 px-2 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl border panel-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">新建自动化</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-sm px-2 py-1 rounded border hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                关闭
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-slate-500">模板</div>
                <select
                  value={createDraft.templateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 panel-surface"
                >
                  {CREATE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <div className="mb-1 text-slate-500">任务名称</div>
                <input
                  value={createDraft.name}
                  onChange={(e) => setCreateDraft((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 panel-surface"
                />
              </label>

              <label className="text-sm">
                <div className="mb-1 text-slate-500">时间表达式（cron 兼容）</div>
                <input
                  value={createDraft.cron}
                  onChange={(e) => setCreateDraft((prev) => ({ ...prev, cron: e.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 panel-surface"
                  placeholder="09:00 / 周一 09:00 / 每2小时"
                />
              </label>

              <label className="text-sm">
                <div className="mb-1 text-slate-500">执行 skill</div>
                <input
                  value={createDraft.skill}
                  onChange={(e) => setCreateDraft((prev) => ({ ...prev, skill: e.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 panel-surface"
                  placeholder="/tell-me"
                />
              </label>

              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-slate-500">描述</div>
                <input
                  value={createDraft.description}
                  onChange={(e) => setCreateDraft((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 panel-surface"
                />
              </label>

              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-slate-500">执行提示词</div>
                <textarea
                  value={createDraft.prompt}
                  onChange={(e) => setCreateDraft((prev) => ({ ...prev, prompt: e.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 panel-surface min-h-24"
                />
              </label>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={createDraft.enabled}
                onChange={(e) => setCreateDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              创建后立即启用
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-xl border text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submittingCreate}
                className="px-4 py-2 rounded-xl text-sm text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {submittingCreate ? "创建中..." : "创建任务"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
