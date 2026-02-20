import { CogIcon } from "@heroicons/react/24/outline";

interface SettingsButtonProps {
  onClick: () => void;
}

export function SettingsButton({ onClick }: SettingsButtonProps) {
  return (
    <button
      onClick={onClick}
      className="h-9 w-9 rounded-lg panel-surface border flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-all duration-200 shadow-[var(--shadow-sm)]"
      aria-label="Open settings"
    >
      <CogIcon className="w-4 h-4" />
    </button>
  );
}
