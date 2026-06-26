import type { ReactNode } from "react";
import { DialogShell } from "./DialogShell";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  isProcessing?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  isProcessing = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmClass =
    variant === "destructive"
      ? "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/35"
      : "bg-[var(--accent)] text-[var(--text-inverse)] hover:bg-[var(--accent-hover)] focus:ring-[var(--accent)]/35";

  return (
    <DialogShell
      isOpen={isOpen}
      title={title}
      size="sm"
      onClose={isProcessing ? undefined : onCancel}
      closeOnBackdrop={!isProcessing}
      showCloseButton={!isProcessing}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--surface-border-strong)] px-4 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isProcessing}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {isProcessing ? "处理中..." : confirmLabel}
          </button>
        </>
      }
    >
      {description && (
        <div className="text-sm leading-6 text-[var(--text-secondary)]">
          {description}
        </div>
      )}
    </DialogShell>
  );
}
