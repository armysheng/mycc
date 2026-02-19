import { useMemo, useState } from "react";
import { PanelTabs, type PanelTab } from "../panel/PanelTabs";
import { SkillList } from "../panel/SkillList";
import { AutomationList } from "../panel/AutomationList";
import { MOCK_AUTOMATIONS, MOCK_SKILLS } from "../panel/mockData";

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function RightPanel({ collapsed, onToggle }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("skills");

  const panelContent = useMemo(() => {
    if (activeTab === "skills") {
      return <SkillList skills={MOCK_SKILLS} />;
    }
    return <AutomationList automations={MOCK_AUTOMATIONS} />;
  }, [activeTab]);

  return (
    <aside
      className={`panel-surface border-l flex flex-col shrink-0 transition-all duration-200 ${
        collapsed ? "w-0 min-w-0 overflow-hidden" : ""
      }`}
      style={
        collapsed
          ? undefined
          : {
              width: "var(--right-panel-width)",
              minWidth: "var(--right-panel-width)",
            }
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

      <div className="p-4 flex-1 overflow-y-auto">
        <PanelTabs activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-3">{panelContent}</div>
      </div>
    </aside>
  );
}
