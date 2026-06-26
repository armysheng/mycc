import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { JSX } from "react";
import { useState, useEffect, useCallback } from "react";

function renderPermissionContent(patterns: string[]): JSX.Element {
  if (patterns.length === 0) {
    return (
      <p className="mb-3 text-slate-600 dark:text-slate-300">
        助理需要在本机执行一个操作来继续，但没有拿到更具体的说明。
      </p>
    );
  }

  if (patterns.length > 1) {
    return (
      <>
        <p className="mb-2 text-slate-700 dark:text-slate-200">
          助理需要在本机执行几项相关操作来继续。
        </p>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          如果不确定，可以先选择不允许，我会继续帮你调整方案。
        </p>
      </>
    );
  }

  return (
    <p className="mb-3 text-slate-700 dark:text-slate-200">
      助理需要在本机执行一个操作来继续。
    </p>
  );
}

function renderPermanentButtonText(): string {
  return "始终允许这类操作";
}

interface PermissionInputPanelProps {
  patterns: string[];
  onAllow: () => void;
  onAllowPermanent: () => void;
  onDeny: () => void;
  getButtonClassName?: (
    buttonType: "allow" | "allowPermanent" | "deny",
    defaultClassName: string,
  ) => string;
  onSelectionChange?: (selection: "allow" | "allowPermanent" | "deny") => void;
  externalSelectedOption?: "allow" | "allowPermanent" | "deny" | null;
}

export function PermissionInputPanel({
  patterns,
  onAllow,
  onAllowPermanent,
  onDeny,
  getButtonClassName = (_, defaultClassName) => defaultClassName,
  onSelectionChange,
  externalSelectedOption,
}: PermissionInputPanelProps) {
  const [selectedOption, setSelectedOption] = useState<
    "allow" | "allowPermanent" | "deny" | null
  >("allow");

  const isExternallyControlled = externalSelectedOption !== undefined;
  const effectiveSelectedOption = externalSelectedOption ?? selectedOption;

  const updateSelectedOption = useCallback(
    (option: "allow" | "allowPermanent" | "deny") => {
      if (externalSelectedOption === undefined) {
        setSelectedOption(option);
      }
      onSelectionChange?.(option);
    },
    [onSelectionChange, externalSelectedOption],
  );

  useEffect(() => {
    if (externalSelectedOption !== undefined) return;

    const options = ["allow", "allowPermanent", "deny"] as const;

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
        if (effectiveSelectedOption === "allow") {
          onAllow();
        } else if (effectiveSelectedOption === "allowPermanent") {
          onAllowPermanent();
        } else if (effectiveSelectedOption === "deny") {
          onDeny();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDeny();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    effectiveSelectedOption,
    onAllow,
    onAllowPermanent,
    onDeny,
    updateSelectedOption,
    externalSelectedOption,
  ]);

  return (
    <div className="flex-shrink-0 rounded-2xl border border-amber-200/80 bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm dark:border-amber-900/40 dark:from-amber-950/20 dark:to-slate-900">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
          <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            需要确认一个本地操作
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">按 ESC 可快速不允许</p>
        </div>
      </div>

      <div className="mb-4">{renderPermissionContent(patterns)}</div>

      <div className="space-y-2">
        <button
          onClick={() => {
            updateSelectedOption("allow");
            onAllow();
          }}
          onFocus={() => updateSelectedOption("allow")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("allow")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "allow",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "allow"
                ? "border-amber-400 bg-amber-100/70 dark:border-amber-700 dark:bg-amber-900/25"
                : "border-slate-200 bg-white hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-amber-700"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">本次允许</span>
        </button>

        <button
          onClick={() => {
            updateSelectedOption("allowPermanent");
            onAllowPermanent();
          }}
          onFocus={() => updateSelectedOption("allowPermanent")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("allowPermanent")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "allowPermanent",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "allowPermanent"
                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                : "border-slate-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-700"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {renderPermanentButtonText()}
          </span>
        </button>

        <button
          onClick={() => {
            updateSelectedOption("deny");
            onDeny();
          }}
          onFocus={() => updateSelectedOption("deny")}
          onBlur={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          onMouseEnter={() => updateSelectedOption("deny")}
          onMouseLeave={() => {
            if (!isExternallyControlled) {
              setSelectedOption(null);
            }
          }}
          className={getButtonClassName(
            "deny",
            `w-full rounded-lg border p-3 text-left transition-all focus:outline-none ${
              effectiveSelectedOption === "deny"
                ? "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20"
                : "border-slate-200 bg-white hover:border-rose-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-rose-700"
            }`,
          )}
        >
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">不允许</span>
        </button>
      </div>
    </div>
  );
}
