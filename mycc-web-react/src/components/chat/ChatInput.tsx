import React, { useRef, useEffect, useMemo, useState } from "react";
import { StopIcon, PaperAirplaneIcon } from "@heroicons/react/24/solid";
import {
  MicrophoneIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { UI_CONSTANTS, KEYBOARD_SHORTCUTS } from "../../utils/constants";
import { useEnterBehavior } from "../../hooks/useSettings";
import { PermissionInputPanel } from "./PermissionInputPanel";
import { PlanPermissionInputPanel } from "./PlanPermissionInputPanel";
import type { ChatImageAttachment, PermissionMode } from "../../types";

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
  onSubmit: (
    messageOverride?: string,
    displayMessage?: string,
    images?: ChatImageAttachment[],
  ) => void;
  onAbort: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  showPermissions?: boolean;
  permissionData?: PermissionData;
  planPermissionData?: PlanPermissionData;
  onSlashRequestRefresh?: () => void;
  slashSkillsLoaded?: boolean;
  slashSkillsLoading?: boolean;
  slashSkills?: Array<{
    id: string;
    name: string;
    trigger: string;
    description?: string;
    installed?: boolean;
    enabled?: boolean;
  }>;
  variant?: "default" | "hero";
  placeholder?: string;
  showPermissionModeControl?: boolean;
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  textPreview?: string;
  image?: ChatImageAttachment;
  truncated?: boolean;
}

const permissionModeName: Record<PermissionMode, string> = {
  bypassPermissions: "自动执行",
  default: "标准执行",
  plan: "规划优先",
  acceptEdits: "自动接受编辑",
};

const MAX_ATTACHMENT_TEXT_CHARS = 12_000;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const TEXT_LIKE_FILE_PATTERN =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|toml|xml|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|hpp|sh|zsh|bash|sql|log)$/i;
const DANGEROUS_TASK_PATTERN =
  /(删除所有|清空|覆盖全部|重置|强推|rm\s+-rf|git\s+reset\s+--hard|git\s+push\s+.*--force|mkfs|format\s+disk)/i;

function hasFileTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.files.length > 0) return true;
  return Array.from(dataTransfer.types).includes("Files");
}

function isTextLikeFile(file: File): boolean {
  return file.type.startsWith("text/") || TEXT_LIKE_FILE_PATTERN.test(file.name);
}

function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(file.type);
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function readFileAsText(file: File): Promise<string | undefined> {
  if (!isTextLikeFile(file)) return undefined;

  try {
    const text =
      typeof file.text === "function"
        ? await file.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error ?? new Error("read failed"));
            reader.readAsText(file);
          });
    return text.length > MAX_ATTACHMENT_TEXT_CHARS
      ? text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)
      : text;
  } catch {
    return undefined;
  }
}

async function readFileAsImage(file: File): Promise<ChatImageAttachment | undefined> {
  if (!isSupportedImageFile(file)) return undefined;

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return undefined;
    return {
      data: match[2],
      mediaType: match[1] || file.type,
    };
  } catch {
    return undefined;
  }
}

function buildAttachmentContext(attachments: ComposerAttachment[]): string {
  if (attachments.length === 0) return "";
  const items = attachments.map((attachment, index) => {
    const header = `${index + 1}. ${attachment.name} (${formatFileSize(attachment.size)})`;
    if (!attachment.textPreview?.trim()) return header;
    return [
      header,
      "```",
      attachment.textPreview,
      attachment.truncated ? "\n...内容已截断" : "",
      "```",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["参考资料：", ...items].join("\n");
}

function buildImagePayloads(
  attachments: ComposerAttachment[],
): ChatImageAttachment[] | undefined {
  const images = attachments
    .map((attachment) => attachment.image)
    .filter((image): image is ChatImageAttachment => Boolean(image));
  return images.length > 0 ? images : undefined;
}

function buildDisplayMessage(input: string, attachments: ComposerAttachment[]): string {
  const trimmed = input.trim();
  const attachmentNames = attachments.map((attachment) => attachment.name).join("、");
  if (!trimmed) return `请参考这些资料：${attachmentNames}`;
  return `${trimmed}\n\n已添加资料：${attachmentNames}`;
}

function confirmDangerousTask(text: string): boolean {
  if (!DANGEROUS_TASK_PATTERN.test(text)) return true;
  return window.confirm(
    "这个任务可能会删除或覆盖内容。确认继续吗？",
  );
}

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
  onSlashRequestRefresh,
  slashSkillsLoaded = false,
  slashSkillsLoading = false,
  slashSkills = [],
  variant = "default",
  placeholder,
  showPermissionModeControl = true,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [dismissedSlashToken, setDismissedSlashToken] = useState<string | null>(null);
  const [slashRefreshToken, setSlashRefreshToken] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const { enterBehavior } = useEnterBehavior();
  const isHero = variant === "hero";

  const slashMatch = useMemo(() => input.match(/^\/([^\s\n]*)$/), [input]);
  const slashToken = slashMatch ? slashMatch[0] : null;
  const slashQuery = (slashMatch?.[1] || "").toLowerCase();
  const installedSkills = useMemo(
    () => slashSkills.filter((skill) => skill.installed && skill.enabled !== false),
    [slashSkills],
  );
  const slashSuggestions = useMemo(() => {
    if (!slashMatch) return [];
    return installedSkills.filter((skill) => {
      const haystack = `${skill.trigger} ${skill.name} ${skill.id}`.toLowerCase();
      return haystack.includes(slashQuery);
    });
  }, [installedSkills, slashMatch, slashQuery]);
  const isSlashPickerOpen = Boolean(
    slashMatch && dismissedSlashToken !== slashToken,
  );

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [slashToken]);

  useEffect(() => {
    if (!slashToken) {
      setSlashRefreshToken(null);
    }
  }, [slashToken]);

  useEffect(() => {
    if (
      isSlashPickerOpen &&
      installedSkills.length === 0 &&
      slashToken &&
      slashRefreshToken !== slashToken
    ) {
      onSlashRequestRefresh?.();
      setSlashRefreshToken(slashToken);
    }
  }, [
    installedSkills.length,
    isSlashPickerOpen,
    onSlashRequestRefresh,
    slashRefreshToken,
    slashToken,
  ]);

  useEffect(() => {
    if (!isLoading && !showPermissions && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading, showPermissions]);

  useEffect(() => {
    const focusInput = () => {
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("mycc:focus-chat-input", focusInput);
    return () => window.removeEventListener("mycc:focus-chat-input", focusInput);
  }, []);

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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isLoading) return;

    const trimmedInput = input.trim();
    if (!trimmedInput && attachments.length === 0) return;

    if (attachments.length === 0) {
      if (!confirmDangerousTask(trimmedInput)) return;
      onSubmit();
      return;
    }

    const attachmentContext = buildAttachmentContext(attachments);
    const messageWithContext = trimmedInput
      ? `${trimmedInput}\n\n${attachmentContext}`
      : attachmentContext;
    if (!confirmDangerousTask(trimmedInput)) return;
    onSubmit(
      messageWithContext,
      buildDisplayMessage(trimmedInput, attachments),
      buildImagePayloads(attachments),
    );
    onInputChange("");
    setAttachments([]);
  };

  const applySlashSkill = (skill: {
    trigger: string;
  }) => {
    const normalizedTrigger = skill.trigger.replace(/^\/+/, "").trim();
    if (!normalizedTrigger) return;
    onInputChange(`/${normalizedTrigger} `);
    setDismissedSlashToken(null);
    setActiveSlashIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleInputChange = (value: string) => {
    onInputChange(value);
    if (dismissedSlashToken && value !== dismissedSlashToken) {
      setDismissedSlashToken(null);
    }
  };

  const getNextPermissionMode = (current: PermissionMode): PermissionMode => {
    const modes: PermissionMode[] = [
      "bypassPermissions",
      "plan",
      "default",
      "acceptEdits",
    ];
    const currentIndex = modes.indexOf(current);
    return modes[(currentIndex + 1) % modes.length];
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSlashPickerOpen && !isComposing) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (slashSuggestions.length > 0) {
          setActiveSlashIndex((prev) => (prev + 1) % slashSuggestions.length);
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (slashSuggestions.length > 0) {
          setActiveSlashIndex(
            (prev) => (prev - 1 + slashSuggestions.length) % slashSuggestions.length,
          );
        }
        return;
      }

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (slashSuggestions.length > 0) {
          applySlashSkill(slashSuggestions[activeSlashIndex] || slashSuggestions[0]);
        }
        return;
      }

      if (e.key === "Escape" && slashToken) {
        e.preventDefault();
        setDismissedSlashToken(slashToken);
        return;
      }
    }

    if (
      showPermissionModeControl &&
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
          handleSubmit();
        }
      } else if (!e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setTimeout(() => setIsComposing(false), 0);
  };

  const addFiles = async (fileList: FileList | File[]) => {
    if (isLoading) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const nextAttachments = await Promise.all(
      files.map(async (file) => {
        const [textPreview, image] = await Promise.all([
          readFileAsText(file),
          readFileAsImage(file),
        ]);
        return {
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          textPreview,
          image,
          truncated: Boolean(textPreview && file.size > MAX_ATTACHMENT_TEXT_CHARS),
        };
      }),
    );

    setAttachments((current) => [...current, ...nextAttachments]);
  };

  const handleDrop = (event: React.DragEvent<HTMLFormElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    void addFiles(event.dataTransfer.files);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
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

  const canSubmit = Boolean(input.trim()) || attachments.length > 0;
  const resolvedPlaceholder = placeholder
    ?? (isLoading && currentRequestId
      ? "正在处理中..."
      : enterBehavior === "send" ? "输入你的问题，Enter 发送" : "输入你的问题，Shift+Enter 发送");

  return (
    <div className={isHero ? "w-full" : "flex-shrink-0 space-y-2"}>
      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          if (!hasFileTransfer(event.dataTransfer)) return;
          event.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!hasFileTransfer(event.dataTransfer)) return;
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return;
          }
          setIsDraggingFiles(false);
        }}
        onDrop={handleDrop}
        data-testid="chat-composer-dropzone"
        className={
          isHero
            ? `relative rounded-[28px] border p-3 text-left shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur dark:shadow-[0_24px_90px_rgba(0,0,0,0.30)] ${
                isDraggingFiles
                  ? "border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40"
                  : "border-slate-200/80 bg-white/90 dark:border-slate-700/80 dark:bg-slate-900/85"
              }`
            : `relative rounded-2xl border p-2 shadow-sm ${
                isDraggingFiles
                  ? "border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/40"
                  : "border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/85"
              }`
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="选择资料"
          onChange={(event) => {
            void addFiles(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
          }}
        />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((attachment) => {
              const attachmentLabel = attachment.image
                ? "图片"
                : attachment.textPreview !== undefined
                  ? "文本"
                  : "仅作为资料名参考";
              const imagePreviewSrc = attachment.image
                ? `data:${attachment.image.mediaType};base64,${attachment.image.data}`
                : undefined;

              return (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  title={`${attachment.name} · ${formatFileSize(attachment.size)} · ${attachmentLabel}`}
                >
                  {imagePreviewSrc && (
                    <img
                      src={imagePreviewSrc}
                      alt={`${attachment.name} 预览`}
                      className="h-8 w-8 rounded-lg border border-white object-cover shadow-sm dark:border-slate-700"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-[180px] truncate">
                      {attachment.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                        {attachmentLabel}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {formatFileSize(attachment.size)}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded-full p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                    aria-label={`移除资料 ${attachment.name}`}
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          placeholder={resolvedPlaceholder}
          rows={isHero ? 4 : 1}
          style={{ maxHeight: `${UI_CONSTANTS.TEXTAREA_MAX_HEIGHT}px` }}
          className={
            isHero
              ? "min-h-[132px] w-full resize-none overflow-hidden rounded-[22px] border border-transparent bg-transparent px-4 py-4 text-base leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white/45 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-950/20"
              : "min-h-[50px] w-full resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-3 py-2 pr-28 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-amber-700 dark:focus:bg-slate-900"
          }
          disabled={isLoading}
        />

        {isSlashPickerOpen && (
          <div className="absolute left-2 right-2 bottom-14 z-20 max-h-64 overflow-y-auto rounded-xl border border-[var(--surface-border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-md)]">
            <div className="px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
              输入 / 选择技能，Enter 或 Tab 填充
            </div>
            {slashSkillsLoading && installedSkills.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                技能加载中，请稍候...
              </div>
            ) : installedSkills.length === 0 && !slashSkillsLoaded ? (
              <div className="px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                正在拉取技能列表，请稍候...
              </div>
            ) : installedSkills.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                暂无已安装技能，请先到技能页安装后再使用。
              </div>
            ) : slashSuggestions.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                没有匹配的技能
              </div>
            ) : (
              <div className="space-y-1">
                {slashSuggestions.map((skill, index) => {
                  const active = index === activeSlashIndex;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashSkill(skill)}
                      className="w-full rounded-lg border px-2.5 py-2 text-left transition"
                      style={
                        active
                          ? {
                              background: "var(--accent-subtle)",
                              borderColor: "var(--accent-border)",
                            }
                          : { borderColor: "transparent" }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {skill.name}
                        </span>
                        <span className="text-xs text-[var(--accent)]">
                          /{skill.trigger.replace(/^\/+/, "")}
                        </span>
                      </div>
                      {skill.description && (
                        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                          {skill.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div
          className={
            isHero
              ? "mt-2 flex items-center justify-between gap-3 px-1"
              : "absolute bottom-3 right-3 flex items-center gap-2"
          }
        >
          {isHero && (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                aria-label="添加资料"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
              {showPermissionModeControl && (
                <button
                  type="button"
                  onClick={() =>
                    onPermissionModeChange(getNextPermissionMode(permissionMode))
                  }
                  className="inline-flex h-9 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-200 dark:hover:bg-amber-900/40"
                  title={`当前模式：${permissionModeName[permissionMode]}；点击切换（Ctrl+Shift+M）`}
                >
                  {permissionModeName[permissionMode]}
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {!isHero && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="添加资料"
                title="添加资料"
                disabled={isLoading}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            )}
            {isLoading && currentRequestId && (
              <button
                type="button"
                onClick={onAbort}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-300 dark:hover:bg-red-950/55"
                aria-label="暂停这次任务"
                title="暂停这次任务 (ESC)"
              >
                <StopIcon className="h-4 w-4" />
              </button>
            )}

            {isHero && (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="语音输入"
              >
                <MicrophoneIcon className="h-4 w-4" />
              </button>
            )}

            <button
              type="submit"
              disabled={!canSubmit || isLoading}
              className={
                isHero
                  ? "inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  : "inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-400"
              }
            >
              <PaperAirplaneIcon className="h-3.5 w-3.5" />
              {permissionMode === "plan" ? "规划" : "发送"}
            </button>
          </div>
        </div>
      </form>

      {!isHero && showPermissionModeControl && (
        <button
          type="button"
          onClick={() => onPermissionModeChange(getNextPermissionMode(permissionMode))}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white/75 px-3 py-1.5 text-xs text-slate-600 transition hover:border-amber-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-amber-700 dark:hover:text-slate-100"
          title={`当前模式：${permissionModeName[permissionMode]}；点击切换（Ctrl+Shift+M）`}
        >
          <span className="font-medium">执行模式：{permissionModeName[permissionMode]}</span>
          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">Ctrl+Shift+M</span>
        </button>
      )}
    </div>
  );
}
