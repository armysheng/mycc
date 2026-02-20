import { useCallback, useEffect, useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { PanelTabs, type PanelTab } from "../panel/PanelTabs";
import { SkillList } from "../panel/SkillList";
import { AutomationList } from "../panel/AutomationList";
import type { AutomationItem, SkillItem } from "../../types/toolbox";
import { getAutomationsUrl, getAuthHeaders, getSkillsUrl } from "../../config/api";
import { useAuth } from "../../contexts/AuthContext";
import { getNetworkErrorMessage, parseApiErrorResponse } from "../../utils/apiError";

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  overlayMode?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

interface SkillsApiResponse {
  success: boolean;
  data?: {
    skills?: Array<{
      id: string;
      name: string;
      description?: string;
      trigger?: string;
      icon?: string;
      status?: "installed" | "available" | "disabled";
    }>;
  };
}

interface AutomationsApiResponse {
  success: boolean;
  data?: {
    automations?: Array<{
      id: string;
      name: string;
      scheduleText?: string;
      status?: "healthy" | "paused" | "error";
      enabled?: boolean;
    }>;
  };
}

function mapSkillsToViewModel(skills?: NonNullable<SkillsApiResponse["data"]>["skills"]): SkillItem[] {
  return (skills || []).map((skill) => {
    const status = skill.status || "available";
    return {
      id: skill.id,
      name: skill.name,
      icon: skill.icon || "⚡",
      trigger: skill.trigger || `/${skill.id}`,
      description: skill.description || "暂无描述",
      status,
      installed: status === "installed",
    };
  });
}

function mapAutomationsToViewModel(
  automations?: NonNullable<AutomationsApiResponse["data"]>["automations"],
): AutomationItem[] {
  return (automations || []).map((item) => ({
    id: item.id,
    name: item.name,
    scheduleText: item.scheduleText || "未配置",
    status: item.status || "healthy",
    enabled: typeof item.enabled === "boolean" ? item.enabled : true,
  }));
}

export function RightPanel({
  collapsed,
  onToggle,
  overlayMode = false,
  isOpen = true,
  onClose,
}: RightPanelProps) {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<PanelTab>("skills");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPanelData = useCallback(async () => {
    if (!token) {
      setError("未检测到登录状态，请重新登录。");
      setSkills([]);
      setAutomations([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [skillsRes, automationsRes] = await Promise.all([
        fetch(getSkillsUrl(), { headers: getAuthHeaders(token) }),
        fetch(getAutomationsUrl(), { headers: getAuthHeaders(token) }),
      ]);

      if (!skillsRes.ok) {
        const parsed = await parseApiErrorResponse(skillsRes);
        throw new Error(parsed.message);
      }
      if (!automationsRes.ok) {
        const parsed = await parseApiErrorResponse(automationsRes);
        throw new Error(parsed.message);
      }

      const skillsJson = (await skillsRes.json()) as SkillsApiResponse;
      const automationsJson = (await automationsRes.json()) as AutomationsApiResponse;

      setSkills(mapSkillsToViewModel(skillsJson.data?.skills));
      setAutomations(mapAutomationsToViewModel(automationsJson.data?.automations));
    } catch (fetchError) {
      setError(getNetworkErrorMessage(fetchError, "加载工具箱数据失败"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPanelData();
  }, [loadPanelData]);

  const panelContent = useMemo(() => {
    if (loading) {
      return (
        <div className="rounded-xl border p-3 text-xs text-[var(--text-secondary)] panel-surface">
          正在加载工具箱数据...
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={loadPanelData}
            className="mt-2 text-xs underline text-red-700 dark:text-red-300"
          >
            重试
          </button>
        </div>
      );
    }

    if (activeTab === "skills") {
      return <SkillList skills={skills} />;
    }
    return <AutomationList automations={automations} />;
  }, [activeTab, automations, error, loadPanelData, loading, skills]);

  const panelClassName = overlayMode
    ? `panel-surface border-l flex flex-col fixed inset-y-0 right-0 z-40 shadow-xl transition-transform duration-200 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`
    : `panel-surface border-l flex flex-col shrink-0 transition-all duration-200 ${
        collapsed ? "w-0 min-w-0 overflow-hidden" : ""
      }`;

  return (
    <aside
      className={panelClassName}
      style={
        !overlayMode && collapsed
          ? undefined
          : {
              width: "var(--right-panel-width)",
              minWidth: "var(--right-panel-width)",
            }
      }
    >
      <div className="px-4 pt-4 pb-3 border-b panel-surface flex items-center justify-between">
        <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          工具箱
        </div>
        {overlayMode ? (
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-[var(--bg-hover)] transition-colors"
            aria-label="关闭工具箱"
          >
            <XMarkIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="px-2.5 py-1 text-xs rounded-md border panel-surface text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            收起
          </button>
        )}
      </div>

      <div className="px-4 py-3 flex-1 overflow-y-auto">
        <PanelTabs activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-3">{panelContent}</div>
      </div>
    </aside>
  );
}
