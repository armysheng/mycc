import type { SkillItem } from "../../types/toolbox";

interface SkillListProps {
  skills: SkillItem[];
}

function getSkillBadge(status: SkillItem["status"]) {
  if (status === "installed") {
    return {
      label: "已安装",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    };
  }
  if (status === "disabled") {
    return {
      label: "不可用",
      className: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    };
  }
  return {
    label: "可安装",
    className:
      "bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]",
  };
}

export function SkillList({ skills }: SkillListProps) {
  if (skills.length === 0) {
    return (
      <div className="rounded-xl border p-3 text-xs text-[var(--text-secondary)] panel-surface">
        暂无技能数据。
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {skills.map((skill) => {
        const badge = getSkillBadge(skill.status);

        return (
          <article
            key={skill.id}
            className="rounded-xl border p-3 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: "var(--surface-border)", background: "var(--bg-surface)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-8 w-8 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center text-[11px] font-semibold text-[var(--text-primary)]">
                  {skill.icon}
                </div>
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold truncate text-[var(--text-primary)]">
                    {skill.name}
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    {skill.trigger}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>

            <p className="mt-2 text-[12px] text-[var(--text-secondary)] leading-relaxed">
              {skill.description}
            </p>
          </article>
        );
      })}
    </div>
  );
}
