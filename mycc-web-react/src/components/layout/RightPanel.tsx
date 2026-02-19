interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function RightPanel({ collapsed, onToggle }: RightPanelProps) {
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

      <div className="p-4 text-sm text-slate-600 dark:text-slate-300">
        <div className="rounded-lg border panel-surface p-3 mb-3">
          ⚡ 技能面板（Phase 2 接入）
        </div>
        <div className="rounded-lg border panel-surface p-3">
          ⏰ 自动化面板（Phase 2 接入）
        </div>
      </div>
    </aside>
  );
}
