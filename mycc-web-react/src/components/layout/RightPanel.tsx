import { useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { PanelTabs, type PanelTab } from "../panel/PanelTabs";
import { SkillList } from "../panel/SkillList";
import { AutomationList } from "../panel/AutomationList";
import { MOCK_AUTOMATIONS, MOCK_SKILLS } from "../panel/mockData";

interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  overlayMode?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export function RightPanel({
  collapsed,
  onToggle,
  overlayMode = false,
  isOpen = true,
  onClose,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("skills");

  const panelContent = useMemo(() => {
    if (activeTab === "skills") {
      return <SkillList skills={MOCK_SKILLS} />;
    }
    return <AutomationList automations={MOCK_AUTOMATIONS} />;
  }, [activeTab]);

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
      <div className="p-4 border-b panel-surface flex items-center justify-between">
        <div className="text-sm font-semibold">工具箱</div>
        {overlayMode ? (
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-md border panel-surface flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭工具箱"
          >
            <XMarkIcon className="h-4 w-4 text-slate-500" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="px-2 py-1 text-xs rounded border panel-surface hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            收起
          </button>
        )}
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <PanelTabs activeTab={activeTab} onChange={setActiveTab} />
        <div className="mt-3">{panelContent}</div>
      </div>
    </aside>
  );
}
