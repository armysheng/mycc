import React, { useRef, useEffect, useState } from "react";
import { StopIcon, PaperAirplaneIcon } from "@heroicons/react/24/solid";
import { UI_CONSTANTS, KEYBOARD_SHORTCUTS } from "../../utils/constants";
import { useEnterBehavior } from "../../hooks/useSettings";
import { PermissionInputPanel } from "./PermissionInputPanel";
import { PlanPermissionInputPanel } from "./PlanPermissionInputPanel";
import type { PermissionMode } from "../../types";

interface PermissionData {
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

interface PlanPermissionData {
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

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  currentRequestId: string | null;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  showPermissions?: boolean;
  permissionData?: PermissionData;
  planPermissionData?: PlanPermissionData;
}

const permissionModeName: Record<PermissionMode, string> = {
  default: "标准执行",
  plan: "规划优先",
  acceptEdits: "自动接受编辑",
};

export function ChatInput({
  input,
  isLoading,
  currentRequestId,
  onInputChange,
  onSubmit,
  onAbort,
  permissionMode,
  onPermissionModeChange,
  showPermissions = false,
  permissionData,
  planPermissionData,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const { enterBehavior } = useEnterBehavior();

  useEffect(() => {
    if (!isLoading && !showPermissions && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading, showPermissions]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const computedStyle = getComputedStyle(textarea);
      const maxHeight =
        parseInt(computedStyle.maxHeight, 10) || UI_CONSTANTS.TEXTAREA_MAX_HEIGHT;
      const scrollHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const getNextPermissionMode = (current: PermissionMode): PermissionMode => {
    const modes: PermissionMode[] = ["default", "plan", "acceptEdits"];
    const currentIndex = modes.indexOf(current);
    return modes[(currentIndex + 1) % modes.length];
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === KEYBOARD_SHORTCUTS.PERMISSION_MODE_TOGGLE &&
      e.shiftKey &&
      e.ctrlKey &&
      !e.metaKey &&
      !isComposing
    ) {
      e.preventDefault();
      onPermissionModeChange(getNextPermissionMode(permissionMode));
      return;
    }

    if (e.key === KEYBOARD_SHORTCUTS.SUBMIT && !isComposing) {
      if (enterBehavior === "newline") {
        if (e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      } else if (!e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setTimeout(() => setIsComposing(false), 0);
  };

  if (showPermissions && planPermissionData) {
    return (
      <PlanPermissionInputPanel
        onAcceptWithEdits={planPermissionData.onAcceptWithEdits}
        onAcceptDefault={planPermissionData.onAcceptDefault}
        onKeepPlanning={planPermissionData.onKeepPlanning}
        getButtonClassName={planPermissionData.getButtonClassName}
        onSelectionChange={planPermissionData.onSelectionChange}
        externalSelectedOption={planPermissionData.externalSelectedOption}
      />
    );
  }

  if (showPermissions && permissionData) {
    return (
      <PermissionInputPanel
        patterns={permissionData.patterns}
        onAllow={permissionData.onAllow}
        onAllowPermanent={permissionData.onAllowPermanent}
        onDeny={permissionData.onDeny}
        getButtonClassName={permissionData.getButtonClassName}
        onSelectionChange={permissionData.onSelectionChange}
        externalSelectedOption={permissionData.externalSelectedOption}
      />
    );
  }

  return (
    <div className="flex-shrink-0 space-y-2">
      <form onSubmit={handleSubmit} className="relative rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/85">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={isLoading && currentRequestId ? "正在处理中..." : "输入你的问题，Enter 发送"}
          rows={1}
          style={{ maxHeight: `${UI_CONSTANTS.TEXTAREA_MAX_HEIGHT}px` }}
          className="min-h-[50px] w-full resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-3 py-2 pr-28 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-amber-700 dark:focus:bg-slate-900"
          disabled={isLoading}
        />

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {isLoading && currentRequestId && (
            <button
              type="button"
              onClick={onAbort}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-300 dark:hover:bg-red-950/55"
              title="停止 (ESC)"
            >
              <StopIcon className="h-4 w-4" />
            </button>
          )}

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <PaperAirplaneIcon className="h-3.5 w-3.5" />
            {permissionMode === "plan" ? "规划" : "发送"}
          </button>
        </div>
      </form>

      <button
        type="button"
        onClick={() => onPermissionModeChange(getNextPermissionMode(permissionMode))}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white/75 px-3 py-1.5 text-xs text-slate-600 transition hover:border-amber-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-amber-700 dark:hover:text-slate-100"
        title={`当前模式：${permissionModeName[permissionMode]}；点击切换（Ctrl+Shift+M）`}
      >
        <span className="font-medium">执行模式：{permissionModeName[permissionMode]}</span>
        <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">Ctrl+Shift+M</span>
      </button>
    </div>
  );
}
