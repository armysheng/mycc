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
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  };
}

export function SkillList({ skills }: SkillListProps) {
  return (
    <div className="space-y-3">
      {skills.map((skill) => {
        const badge = getSkillBadge(skill.status);

        return (
          <article key={skill.id} className="rounded-lg border panel-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {skill.icon}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold truncate">{skill.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
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

            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {skill.description}
            </p>
          </article>
        );
      })}
    </div>
  );
}
