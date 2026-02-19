export type PanelTab = "skills" | "automations";

interface PanelTabsProps {
  activeTab: PanelTab;
  onChange: (tab: PanelTab) => void;
}

export function PanelTabs({ activeTab, onChange }: PanelTabsProps) {
  const tabBaseClass =
    "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors";

  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border panel-surface p-1">
      <button
        type="button"
        onClick={() => onChange("skills")}
        className={`${tabBaseClass} ${
          activeTab === "skills"
            ? "bg-sky-500 text-white"
            : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        技能
      </button>
      <button
        type="button"
        onClick={() => onChange("automations")}
        className={`${tabBaseClass} ${
          activeTab === "automations"
            ? "bg-sky-500 text-white"
            : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
      >
        自动化
      </button>
    </div>
  );
}
