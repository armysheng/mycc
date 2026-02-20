import { useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { GeneralSettings } from "./settings/GeneralSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscKey);
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscKey);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-md p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-gradient-to-b from-white to-stone-50 dark:from-slate-900 dark:to-slate-900 shadow-2xl">
        <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/10" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-sky-300/15 blur-3xl dark:bg-sky-500/10" />

        <div className="relative flex items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/70 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              偏好设置
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              管理你的账号展示、对话行为与界面风格。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close settings"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="relative overflow-y-auto max-h-[calc(90vh-110px)]">
          <div className="p-6">
            <GeneralSettings />
          </div>
        </div>
      </div>
    </div>
  );
}
