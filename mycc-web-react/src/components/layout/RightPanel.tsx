import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAutomationsUrl,
  getAuthHeaders,
  getSkillInstallUrl,
  getSkillsUrl,
} from "../../config/api";

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  token: string | null;
  onSkillUse?: (trigger: string) => void;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  icon: string;
  status: "installed" | "available" | "disabled";
  installed: boolean;
  version: string;
  installedVersion: string | null;
  latestVersion: string;
  source: string;
  legacy: boolean;
}

interface AutomationItem {
  id: string;
  name: string;
  scheduleText: string;
  skill: string;
  description: string;
  status: "healthy" | "paused" | "error";
  enabled: boolean;
}

export function RightPanel({ collapsed, onToggle, token, onSkillUse }: RightPanelProps) {
  const [tab, setTab] = useState<"skills" | "automations">("skills");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [skillsRes, automationsRes] = await Promise.all([
        fetch(getSkillsUrl(), { headers: getAuthHeaders(token) }),
        fetch(getAutomationsUrl(), { headers: getAuthHeaders(token) }),
      ]);
      if (!skillsRes.ok) {
        throw new Error(`技能接口异常: ${skillsRes.status} ${skillsRes.statusText}`);
      }
      if (!automationsRes.ok) {
        throw new Error(`自动化接口异常: ${automationsRes.status} ${automationsRes.statusText}`);
      }
      const skillsJson = await skillsRes.json();
      const automationsJson = await automationsRes.json();
      setSkills((skillsJson?.data?.skills || []) as SkillItem[]);
      setAutomations((automationsJson?.data?.automations || []) as AutomationItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载工具箱失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleInstall = useCallback(
    async (skillId: string) => {
      if (!token) return;
      setInstallingId(skillId);
      setError(null);
      try {
        const res = await fetch(getSkillInstallUrl(skillId), {
          method: "POST",
          headers: getAuthHeaders(token),
          body: "{}",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `安装失败: ${res.status} ${res.statusText}`);
        }
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : "安装技能失败");
      } finally {
        setInstallingId(null);
      }
    },
    [loadData, token],
  );

  const skillsStats = useMemo(() => {
    const installed = skills.filter((s) => s.installed).length;
    return `${installed}/${skills.length} 已安装`;
  }, [skills]);

  return (
    <aside
      className={`panel-surface border-l flex flex-col shrink-0 transition-all duration-200 ${
        collapsed ? "w-0 min-w-0 overflow-hidden" : ""
      }`}
      style={
        collapsed
          ? undefined
          : { width: "var(--right-panel-width)", minWidth: "var(--right-panel-width)" }
      }
    >
      <div className="p-4 border-b panel-surface flex items-center justify-between">
        <div className="text-sm font-semibold">工具箱</div>
        <button
          type="button"
          onClick={onToggle}
          className="px-2 py-1 text-xs rounded border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          收起
        </button>
      </div>

      <div className="px-4 pt-3 pb-2 border-b panel-surface">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("skills")}
            className={`px-3 py-1.5 text-xs rounded-md border ${
              tab === "skills" ? "text-[var(--text-inverse)]" : "panel-surface"
            }`}
            style={
              tab === "skills"
                ? { background: "var(--accent)", borderColor: "var(--accent)" }
                : undefined
            }
          >
            ⚡ 技能
          </button>
          <button
            type="button"
            onClick={() => setTab("automations")}
            className={`px-3 py-1.5 text-xs rounded-md border ${
              tab === "automations" ? "text-[var(--text-inverse)]" : "panel-surface"
            }`}
            style={
              tab === "automations"
                ? { background: "var(--accent)", borderColor: "var(--accent)" }
                : undefined
            }
          >
            ⏰ 自动化
          </button>
          <button
            type="button"
            onClick={loadData}
            className="ml-auto px-2 py-1 text-xs rounded border panel-surface"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="p-4 text-sm overflow-y-auto flex-1">
        {loading && <div className="text-xs text-slate-500">加载中...</div>}
        {error && <div className="text-xs text-red-600 mb-3">系统错误：{error}</div>}

        {!loading && tab === "skills" && (
          <div>
            <div className="text-xs text-slate-500 mb-2">技能状态：{skillsStats}</div>
            <div className="space-y-2">
              {skills.length === 0 && (
                <div className="text-xs text-slate-500 border rounded-md p-3">
                  暂无技能。请先确保 VPS 有技能目录或等待自动初始化完成。
                </div>
              )}
              {skills.map((skill) => {
                const upgradable =
                  skill.installedVersion &&
                  skill.latestVersion &&
                  skill.installedVersion !== skill.latestVersion;
                return (
                  <div key={skill.id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span>{skill.icon}</span>
                      <div className="font-medium text-sm">{skill.name}</div>
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border">
                        {skill.installed ? "已安装" : "可安装"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{skill.description || "无描述"}</div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      触发词：<code>{skill.trigger}</code>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      版本：{skill.installedVersion || "-"} / 最新 {skill.latestVersion}
                      {skill.legacy && <span className="ml-1 text-amber-600">legacy</span>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      {!skill.installed ? (
                        <button
                          type="button"
                          onClick={() => handleInstall(skill.id)}
                          disabled={installingId === skill.id}
                          className="px-2 py-1 text-xs rounded text-[var(--text-inverse)] disabled:opacity-60"
                          style={{ background: "var(--accent)" }}
                        >
                          {installingId === skill.id ? "安装中..." : "安装"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSkillUse?.(skill.trigger)}
                          className="px-2 py-1 text-xs rounded border panel-surface"
                        >
                          使用
                        </button>
                      )}
                      {upgradable && (
                        <span className="px-2 py-1 text-[10px] rounded bg-amber-100 text-amber-700">
                          可升级
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && tab === "automations" && (
          <div className="space-y-2">
            {automations.length === 0 && (
              <div className="text-xs text-slate-500 border rounded-md p-3">暂无自动化任务</div>
            )}
            {automations.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{item.name}</div>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border">
                    {item.enabled ? "启用中" : "已暂停"}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">{item.scheduleText}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {item.skill} · {item.description}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
