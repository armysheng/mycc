import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

type DialogSize = "sm" | "md" | "lg" | "xl";

interface DialogShellProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  size?: DialogSize;
  initialFocusRef?: RefObject<HTMLElement>;
}

const sizeClass: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-4xl",
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"),
  );
}

export function DialogShell({
  isOpen,
  title,
  subtitle,
  children,
  footer,
  onClose,
  closeLabel = "关闭",
  closeOnBackdrop = true,
  showCloseButton = true,
  size = "md",
  initialFocusRef,
}: DialogShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const initialTarget = initialFocusRef?.current;
      const focusables = getFocusableElements(dialogRef.current);
      (initialTarget || focusables[0] || dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [initialFocusRef, isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && onClose && event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={`flex max-h-[90vh] w-full ${sizeClass[size]} flex-col overflow-hidden rounded-xl border border-[var(--surface-border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle && (
              <p
                id={descriptionId}
                className="mt-1 text-sm leading-5 text-[var(--text-secondary)]"
              >
                {subtitle}
              </p>
            )}
          </div>
          {showCloseButton && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition hover:border-[var(--surface-border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/35"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
