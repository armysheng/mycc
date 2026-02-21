import type { AutomationItem } from "../../types/toolbox";

interface AutomationListProps {
  automations: AutomationItem[];
}

function getStatusDotClass(status: AutomationItem["status"]) {
  if (status === "healthy") {
    return "bg-emerald-500";
  }
  if (status === "paused") {
    return "bg-slate-400";
  }
  return "bg-red-500";
}

function getStatusLabel(status: AutomationItem["status"]) {
  if (status === "healthy") {
    return "运行中";
  }
  if (status === "paused") {
    return "已暂停";
  }
  return "异常";
}

export function AutomationList({ automations }: AutomationListProps) {
  if (automations.length === 0) {
    return (
      <div className="rounded-xl border p-3 text-xs text-[var(--text-secondary)] panel-surface">
        暂无自动化任务。
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {automations.map((automation) => (
        <article
          key={automation.id}
          className="rounded-xl border p-3 transition-colors hover:bg-[var(--bg-hover)]"
          style={{ borderColor: "var(--surface-border)", background: "var(--bg-surface)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[13px] font-semibold truncate text-[var(--text-primary)]">
                {automation.name}
              </h4>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {automation.scheduleText}
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={automation.enabled}
                readOnly
                className="sr-only"
                aria-label={`${automation.name} 开关`}
              />
              <span
                className={`h-5 w-9 rounded-full p-[2px] transition-colors ${
                  automation.enabled
                    ? "bg-[var(--accent)]"
                    : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                    automation.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="mt-2 inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className={`inline-block h-2 w-2 rounded-full ${getStatusDotClass(automation.status)}`} />
            {getStatusLabel(automation.status)}
          </div>
        </article>
      ))}

      <button
        type="button"
        className="w-full rounded-lg border border-dashed panel-surface px-3 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        新建自动化任务
      </button>
    </div>
  );
}
