import { useState, useEffect, useCallback } from "react";

interface PlanPermissionInputPanelProps {
  onAcceptWithEdits: () => void;
  onAcceptDefault: () => void;
  onKeepPlanning: () => void;
  getButtonClassName?: (
    buttonType: "acceptWithEdits" | "acceptDefault" | "keepPlanning",
    defaultClassName: string,
  ) => string;
  onSelectionChange?: (
    selection: "acceptWithEdits" | "acceptDefault" | "keepPlanning",
  ) => void;
  externalSelectedOption?:
    | "acceptWithEdits"
    | "acceptDefault"
    | "keepPlanning"
    | null;
}

export function PlanPermissionInputPanel({
  onAcceptWithEdits,
  onAcceptDefault,
  onKeepPlanning,
  getButtonClassName = (_, defaultClassName) => defaultClassName,
  onSelectionChange,
  externalSelectedOption,
}: PlanPermissionInputPanelProps) {
  const [selectedOption, setSelectedOption] = useState<
    "acceptWithEdits" | "acceptDefault" | "keepPlanning" | null
  >("acceptWithEdits");

  const isExternallyControlled = externalSelectedOption !== undefined;
  const effectiveSelectedOption = externalSelectedOption ?? selectedOption;

  const updateSelectedOption = useCallback(
    (option: "acceptWithEdits" | "acceptDefault" | "keepPlanning") => {
      if (externalSelectedOption === undefined) {
        setSelectedOption(option);
      }
      onSelectionChange?.(option);
    },
    [onSelectionChange, externalSelectedOption],
  );

  useEffect(() => {
    if (externalSelectedOption !== undefined) return;

    const options = ["acceptWithEdits", "acceptDefault", "keepPlanning"] as const;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = options.indexOf(effectiveSelectedOption!);
        const nextIndex = (currentIndex + 1) % options.length;
        updateSelectedOption(options[nextIndex]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const currentIndex = options.indexOf(effectiveSelectedOption!);
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        updateSelectedOption(options[prevIndex]);
      } else if (e.key === "Enter" && effectiveSelectedOption) {
        e.preventDefault();
        if (effectiveSelectedOption === "acceptWithEdits") {
          onAcceptWithEdits();
        } else if (effectiveSelectedOption === "acceptDefault") {
          onAcceptDefault();
        } else if (effectiveSelectedOption === "keepPlanning") {
          onKeepPlanning();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onKeepPlanning();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    effectiveSelectedOption,
    onAcceptDefault,
    onAcceptWithEdits,
    onKeepPlanning,
    updateSelectedOption,
    externalSelectedOption,
  ]);

  return (
    <div className="flex-shrink-0 rounded-2xl border border-sky-200/80 bg-gradient-to-b from-sky-50 to-white p-4 shadow-sm dark:border-sky-900/35 dark:from-sky-950/20 dark:to-slate-900">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">规划阶段确认</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">请选择下一步动作（ESC = 继续规划）</p>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => {
            updateSelectedOption("acceptWithEdits");
            onAcceptWithEdits();
          }}
          onFocus={() => updateSelectedOption("acceptWithEdits")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("acceptWithEdits")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "acceptWithEdits",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "acceptWithEdits"
                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                : "border-slate-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-700"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">接受并自动应用编辑</span>
        </button>

        <button
          onClick={() => {
            updateSelectedOption("acceptDefault");
            onAcceptDefault();
          }}
          onFocus={() => updateSelectedOption("acceptDefault")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("acceptDefault")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "acceptDefault",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "acceptDefault"
                ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/20"
                : "border-slate-200 bg-white hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">接受并手动审批编辑</span>
        </button>

        <button
          onClick={() => {
            updateSelectedOption("keepPlanning");
            onKeepPlanning();
          }}
          onFocus={() => updateSelectedOption("keepPlanning")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("keepPlanning")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "keepPlanning",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "keepPlanning"
                ? "border-slate-400 bg-slate-50 dark:border-slate-600 dark:bg-slate-800"
                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">继续规划</span>
        </button>
      </div>
    </div>
  );
}
