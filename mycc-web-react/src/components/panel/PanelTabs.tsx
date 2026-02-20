export type PanelTab = "skills" | "automations";

interface PanelTabsProps {
  activeTab: PanelTab;
  onChange: (tab: PanelTab) => void;
}

export function PanelTabs({ activeTab, onChange }: PanelTabsProps) {
  const tabBaseClass =
    "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors";

  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border p-1 bg-[var(--bg-elevated)] border-[var(--surface-border)]">
      <button
        type="button"
        onClick={() => onChange("skills")}
        className={`${tabBaseClass} ${
          activeTab === "skills"
            ? "text-[var(--text-primary)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]"
            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
      >
        ⚡ 技能
      </button>
      <button
        type="button"
        onClick={() => onChange("automations")}
        className={`${tabBaseClass} ${
          activeTab === "automations"
            ? "text-[var(--text-primary)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]"
            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
      >
        ⏰ 自动化
      </button>
    </div>
  );
}
