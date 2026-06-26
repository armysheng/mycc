import type { ReactNode } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

type AlertSeverity = "info" | "success" | "warning" | "error";

interface InlineAlertProps {
  severity?: AlertSeverity;
  title?: string;
  children: ReactNode;
  className?: string;
}

const alertStyles: Record<AlertSeverity, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-100",
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-400/10 dark:text-red-100",
};

const iconStyles: Record<AlertSeverity, string> = {
  info: "text-sky-600 dark:text-sky-300",
  success: "text-emerald-600 dark:text-emerald-300",
  warning: "text-amber-600 dark:text-amber-300",
  error: "text-red-600 dark:text-red-300",
};

export function InlineAlert({
  severity = "info",
  title,
  children,
  className = "",
}: InlineAlertProps) {
  const Icon =
    severity === "success"
      ? CheckCircleIcon
      : severity === "info"
        ? InformationCircleIcon
        : ExclamationTriangleIcon;

  return (
    <div
      role={severity === "error" || severity === "warning" ? "alert" : "status"}
      className={`rounded-lg border px-3.5 py-3 text-sm shadow-[var(--shadow-sm)] ${alertStyles[severity]} ${className}`}
    >
      <div className="flex gap-2.5">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${iconStyles[severity]}`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          {title && <div className="font-semibold">{title}</div>}
          <div className={title ? "mt-0.5 leading-5" : "leading-5"}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
