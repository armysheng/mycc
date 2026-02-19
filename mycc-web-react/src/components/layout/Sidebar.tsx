interface SidebarProps {
  onNewChat: () => void;
  currentPathLabel?: string;
}

export function Sidebar({ onNewChat, currentPathLabel }: SidebarProps) {
  return (
    <aside
      className="panel-surface border-r flex flex-col shrink-0"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="p-4 border-b panel-surface">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-sky-500 text-white flex items-center justify-center font-semibold">
            cc
          </div>
          <div>
            <div className="text-sm font-semibold">MyCC</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              多用户助手
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="w-full rounded-lg px-3 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white transition-colors"
        >
          新对话
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          对话管理（Phase 3 完整接入）
        </div>
        <div className="rounded-lg border panel-surface p-3 text-xs text-slate-600 dark:text-slate-300">
          当前工作区
          <div className="font-mono mt-1 break-all">
            {currentPathLabel || "/"}
          </div>
        </div>
      </div>
    </aside>
  );
}
