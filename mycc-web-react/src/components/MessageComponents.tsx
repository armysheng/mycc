import type {
  ChatMessage,
  SystemMessage,
  ToolMessage,
  ToolResultMessage,
  PlanMessage,
  ThinkingMessage,
  TodoMessage,
  TodoItem,
  HooksMessage,
} from "../types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  ArrowPathIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { TimestampComponent } from "./TimestampComponent";
import { MessageContainer } from "./messages/MessageContainer";
import { CollapsibleDetails } from "./messages/CollapsibleDetails";
import {
  createEditResult,
  createBashPreview,
  createContentPreview,
  isEditToolUseResult,
  isBashToolUseResult,
} from "../utils/contentUtils";
import { getToolActivityLabel } from "../utils/toolDisplayMapper";

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const safeHref = sanitizeUrl(href);
          if (!safeHref) {
            return <span>{children}</span>;
          }
          return (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-slate-400 hover:decoration-slate-700 dark:decoration-slate-500 dark:hover:decoration-slate-200"
            >
              {children}
            </a>
          );
        },
        pre: ({ children }) => (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed overflow-x-auto rounded-md bg-black/5 p-2 dark:bg-white/10">
            {children}
          </pre>
        ),
        code: ({ children, className }) => (
          <code className={className || "text-sm"}>{children}</code>
        ),
        p: ({ children }) => (
          <p className="text-sm leading-relaxed mb-2">{children}</p>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ANSI escape sequence regex for cleaning hooks messages
const ANSI_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const LOW_LEVEL_SYSTEM_ERROR_PATTERN =
  /E2B|CCR|Agent SDK|code-server|GNU|Remote IDE|sandbox|Claude Code|base url|traffic|tokens?|provider|desktop_pid|websockify|Bad Request|Internal Server Error|request failed|Command failed|exit status \d+|exit code \d+|invalid_argument|starting process|fork\/exec|argument list too long|\/bin\/(?:ba)?sh|\/opt\/mycc-agent-runtime|bridge\.mjs/i;

function getToolResultLabel(toolName: string): string {
  if (toolName === "Bash") return "本地操作结果";
  if (toolName === "Edit" || toolName === "Write") return "整理结果";
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
    return "资料查找结果";
  }
  return "运行结果";
}

function isVerboseSkillRuntimeDetails(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith("Base directory for this skill:") ||
    trimmed.includes("\n# Browser Use In MyCC Sandbox")
  );
}

function getUserFacingSystemError(message: string): string {
  const cleaned = message.trim();
  if (!cleaned || LOW_LEVEL_SYSTEM_ERROR_PATTERN.test(cleaned)) {
    return "这次操作没有跑通。可以直接重试，或让我换个方式继续。";
  }
  return cleaned;
}

// Type guard to check if the message is a hooks message
function isHooksMessage(
  msg: SystemMessage,
): msg is HooksMessage & { timestamp: number } {
  return (
    msg.type === "system" &&
    "content" in msg &&
    typeof msg.content === "string" &&
    !("subtype" in msg)
  );
}

function isAbortMessage(message: SystemMessage): boolean {
  return (
    message.type === "system" &&
    "subtype" in message &&
    message.subtype === "abort"
  );
}

function getAbortGuidance(message: SystemMessage): string {
  const title =
    "message" in message && typeof message.message === "string"
      ? message.message
      : "已暂停这次任务";
  const status =
    "status" in message && typeof message.status === "string"
      ? message.status
      : "paused";
  if (status === "ended") {
    return [
      title,
      "你可以重新发送，或补充说明后再尝试。",
    ].join("\n");
  }
  if (status === "failed") {
    return [
      title,
      "当前未能确认任务是否已暂停；如果页面仍在等待，可以稍后重试或刷新后继续。",
    ].join("\n");
  }
  return [
    title,
    "你可以补充说明后继续，或重新尝试这次任务。",
    "右侧工作区会保留已经整理出的内容，方便你接着查看和接管。",
  ].join("\n");
}

function getAbortStatus(message: SystemMessage): string {
  return "status" in message && typeof message.status === "string"
    ? message.status
    : "paused";
}

interface ChatMessageComponentProps {
  message: ChatMessage;
  assistantDisplayName: string;
  assistantAvatarText: string;
  onReEditMessage?: (content: string) => void;
  onRetryMessage?: (content: string) => void;
  retryContent?: string;
  retryDisabled?: boolean;
}

export function ChatMessageComponent({
  message,
  assistantDisplayName,
  assistantAvatarText,
  onReEditMessage,
  onRetryMessage,
  retryContent,
  retryDisabled = false,
}: ChatMessageComponentProps) {
  const isUser = message.role === "user";
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyMessage = async () => {
    if (!navigator.clipboard) {
      setCopyStatus("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  const copyLabel =
    copyStatus === "copied"
      ? "已复制"
      : copyStatus === "failed"
        ? "复制失败"
        : isUser
          ? "复制这条消息"
          : "复制这条回复";
  const copyTitle =
    copyStatus === "copied"
      ? "已复制"
      : copyStatus === "failed"
        ? "复制失败"
        : "复制";

  if (isUser) {
    return (
      <div className="group mb-4 flex justify-end">
        <div
          className="max-w-[86%] sm:max-w-[72%] rounded-2xl rounded-br-md px-4 py-3 border"
          style={{
            background: "var(--user-bubble)",
            color: "var(--user-bubble-text)",
            borderColor: "var(--surface-border)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <span className="text-xs font-semibold opacity-90">你</span>
            <TimestampComponent
              timestamp={message.timestamp}
              className="text-xs opacity-70"
            />
          </div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </pre>
          <MessageActionBar align="right">
            {onReEditMessage && (
              <MessageActionButton
                onClick={() => onReEditMessage(message.content)}
                aria-label="重新编辑这条消息"
                title="重新编辑"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </MessageActionButton>
            )}
            <MessageActionButton
              onClick={() => {
                void copyMessage();
              }}
              aria-label={copyLabel}
              title={copyTitle}
            >
              <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </MessageActionButton>
          </MessageActionBar>
        </div>
      </div>
    );
  }

  return (
    <div className="group mb-4 flex justify-start">
      <div
        className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          border: "1px solid var(--surface-border)",
        }}
      >
        {assistantAvatarText}
      </div>
      <div
        className="max-w-[86%] sm:max-w-[72%] rounded-2xl rounded-bl-md px-4 py-3 border"
        style={{
          background: "var(--assistant-bubble)",
          color: "var(--assistant-bubble-text)",
          borderColor: "var(--surface-border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="mb-1.5 flex items-center justify-between gap-4">
          <span className="text-xs font-semibold opacity-90">
            {assistantDisplayName}
          </span>
          <TimestampComponent
            timestamp={message.timestamp}
            className="text-xs opacity-70"
          />
        </div>
        <div className="space-y-2">
          <AssistantMarkdown content={message.content} />
        </div>
        <MessageActionBar align="left">
          <MessageActionButton
            onClick={() => {
              void copyMessage();
            }}
            aria-label={copyLabel}
            title={copyTitle}
          >
            <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </MessageActionButton>
          {retryContent && onRetryMessage && (
            <MessageActionButton
              onClick={() => onRetryMessage(retryContent)}
              aria-label="重新生成这条回复"
              title="重新生成"
              disabled={retryDisabled}
            >
              <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </MessageActionButton>
          )}
        </MessageActionBar>
      </div>
    </div>
  );
}

function MessageActionBar({
  align,
  children,
}: {
  align: "left" | "right";
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "mt-2 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
        align === "right" ? "justify-end" : "justify-start",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function MessageActionButton({
  children,
  disabled = false,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-white/75 text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-slate-900/75 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus:ring-offset-slate-900"
      {...props}
    >
      {children}
    </button>
  );
}

interface SystemMessageComponentProps {
  message: SystemMessage;
}

export function SystemMessageComponent({
  message,
}: SystemMessageComponentProps) {
  // Generate details based on message type and subtype
  const getDetails = () => {
    if (isAbortMessage(message)) {
      return getAbortGuidance(message);
    } else if (
      message.type === "system" &&
      "subtype" in message &&
      message.subtype === "init"
    ) {
      return "";
    } else if (message.type === "result") {
      if (message.is_error !== true) {
        return "";
      }
      const resultText =
        "result" in message && typeof message.result === "string"
          ? message.result
          : "";
      return getUserFacingSystemError(resultText);
    } else if (message.type === "error") {
      return getUserFacingSystemError(message.message);
    } else if (isHooksMessage(message)) {
      // This is a hooks message - show only the content
      // Remove ANSI escape sequences for cleaner display
      return message.content.replace(ANSI_REGEX, "");
    }
    return JSON.stringify(message, null, 2);
  };

  // Get label based on message type
  const getLabel = () => {
    if (isAbortMessage(message)) {
      const status = getAbortStatus(message);
      if (status === "ended") return "已结束";
      if (status === "failed") return "需要处理的问题";
      return "已暂停";
    }
    if (message.type === "system") return "处理动态";
    if (message.type === "result") return "需要处理的问题";
    if (message.type === "error") return "需要处理的问题";
    return "处理动态";
  };

  const details = getDetails().trim();
  if (!details) return null;
  const isError =
    message.type === "error" ||
    (message.type === "result" && message.is_error === true);
  const isResult = message.type === "result" && !isError;
  const isAbort = isAbortMessage(message);
  const isHook = isHooksMessage(message);
  const shouldFoldVerboseRuntimeDetails =
    isHook && isVerboseSkillRuntimeDetails(details);

  const colorScheme = isError
    ? {
        header: "text-red-800 dark:text-red-300",
        content: "text-red-700 dark:text-red-300",
        border: "border-red-200 dark:border-red-700",
        bg: "bg-red-50/80 dark:bg-red-900/20 border border-red-200 dark:border-red-800",
      }
      : isResult
        ? {
            header: "text-emerald-800 dark:text-emerald-300",
            content: "text-emerald-700 dark:text-emerald-300",
            border: "border-emerald-200 dark:border-emerald-700",
            bg: "bg-emerald-50/80 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800",
          }
        : isAbort
          ? {
              header: "text-amber-800 dark:text-amber-200",
              content: "text-amber-800 dark:text-amber-100",
              border: "border-amber-200 dark:border-amber-700",
              bg: "bg-amber-50/90 dark:bg-amber-900/25 border border-amber-200 dark:border-amber-800",
            }
          : {
              header: "text-blue-800 dark:text-blue-300",
              content: "text-blue-700 dark:text-blue-300",
              border: "border-blue-200 dark:border-blue-700",
              bg: "bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
            };

  return (
    <CollapsibleDetails
      label={getLabel()}
      details={details}
      badge={undefined}
      icon={
        isError ? (
          <span className="bg-red-500 dark:bg-red-600">!</span>
        ) : isAbort ? (
          <span className="bg-amber-500 dark:bg-amber-500">II</span>
        ) : (
          <span className="bg-blue-400 dark:bg-blue-500">⚙</span>
        )
      }
      colorScheme={colorScheme}
      defaultExpanded={
        isError || isAbort || (isHook && !shouldFoldVerboseRuntimeDetails)
      }
      showPreview={!shouldFoldVerboseRuntimeDetails}
      detailsBorderStyle={isError ? "dashed" : "solid"}
    />
  );
}

interface ToolMessageComponentProps {
  message: ToolMessage;
}

export function ToolMessageComponent({ message }: ToolMessageComponentProps) {
  const displayText = getToolActivityLabel(message.toolName, message.input);

  return (
    <CollapsibleDetails
      label={displayText}
      details={message.content}
      badge="进行中"
      icon={<span className="bg-emerald-400 dark:bg-emerald-500">⚡</span>}
      colorScheme={{
        header: "text-emerald-800 dark:text-emerald-300",
        content: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-200 dark:border-emerald-700",
        bg: "bg-emerald-50/90 dark:bg-emerald-900/20",
      }}
      showPreview={false}
      variant="pill"
    />
  );
}

interface ToolResultMessageComponentProps {
  message: ToolResultMessage;
}

export function ToolResultMessageComponent({
  message,
}: ToolResultMessageComponentProps) {
  const toolUseResult = message.toolUseResult;

  let previewContent: string | undefined;
  let previewSummary: string | undefined;
  let maxPreviewLines = 3;
  let displayContent = message.content;
  let defaultExpanded = false;
  const shouldFoldVerboseRuntimeDetails = isVerboseSkillRuntimeDetails(
    message.content,
  );

  // Handle Edit tool results with structuredPatch
  if (message.toolName === "Edit" && isEditToolUseResult(toolUseResult)) {
    const editResult = createEditResult(
      toolUseResult.structuredPatch,
      message.content,
      20, // autoExpandThreshold: auto-expand if 20 lines or fewer
    );
    displayContent = editResult.details;
    previewSummary = editResult.summary;
    previewContent = editResult.previewContent;
    defaultExpanded = editResult.defaultExpanded;
    maxPreviewLines = 20; // Use 20 for Edit results to match previewContent
  }

  // Handle Bash tool results with stdout/stderr
  else if (message.toolName === "Bash" && isBashToolUseResult(toolUseResult)) {
    const isError = Boolean(toolUseResult.stderr?.trim());
    const bashPreview = createBashPreview(
      toolUseResult.stdout || "",
      toolUseResult.stderr || "",
      isError,
      3,
    );
    if (bashPreview.hasMore) {
      previewContent = bashPreview.preview;
    }
  }

  // Handle specific tool results that benefit from content preview
  // Note: Read tool should NOT show preview, only line counts in summary
  else if (message.toolName === "Grep" && message.content.trim().length > 0) {
    const contentPreview = createContentPreview(message.content, 3);
    if (contentPreview.hasMore) {
      previewContent = contentPreview.preview;
    }
  }

  // Determine if preview should be shown for this tool
  const shouldShowPreview =
    message.toolName === "Bash" ||
    message.toolName === "Edit" ||
    message.toolName === "Grep";

  return (
    <CollapsibleDetails
      label={getToolResultLabel(message.toolName)}
      details={displayContent}
      badge={message.summary}
      icon={<span className="bg-emerald-400 dark:bg-emerald-500">✓</span>}
      colorScheme={{
        header: "text-emerald-800 dark:text-emerald-300",
        content: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-200 dark:border-emerald-700",
        bg: "bg-emerald-50/90 dark:bg-emerald-900/20",
      }}
      previewContent={previewContent}
      previewSummary={previewSummary}
      maxPreviewLines={maxPreviewLines}
      showPreview={shouldShowPreview && !shouldFoldVerboseRuntimeDetails}
      defaultExpanded={
        shouldFoldVerboseRuntimeDetails ? false : defaultExpanded
      }
      variant="pill"
    />
  );
}

interface PlanMessageComponentProps {
  message: PlanMessage;
}

export function PlanMessageComponent({ message }: PlanMessageComponentProps) {
  return (
    <MessageContainer
      alignment="left"
      colorScheme="bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold opacity-90 text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-500 dark:bg-blue-600 rounded-full flex items-center justify-center text-white text-xs">
            📋
          </div>
          准备继续
        </div>
        <TimestampComponent
          timestamp={message.timestamp}
          className="text-xs opacity-70 text-blue-600 dark:text-blue-400"
        />
      </div>

      <div className="mb-3">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
          我整理了一个执行计划：
        </p>
        <div className="bg-blue-100/50 dark:bg-blue-800/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
          <pre className="text-sm text-blue-900 dark:text-blue-100 whitespace-pre-wrap font-mono leading-relaxed">
            {message.plan}
          </pre>
        </div>
      </div>
    </MessageContainer>
  );
}

interface ThinkingMessageComponentProps {
  message: ThinkingMessage;
  autoExpand?: boolean;
}

export function ThinkingMessageComponent({
  message,
  autoExpand = false,
}: ThinkingMessageComponentProps) {
  return (
    <CollapsibleDetails
      label="思考过程"
      details={message.content}
      badge="thinking"
      icon={<span className="bg-purple-400 dark:bg-purple-500">💭</span>}
      colorScheme={{
        header: "text-purple-700 dark:text-purple-300",
        content: "text-purple-600 dark:text-purple-400 italic",
        border: "border-purple-200 dark:border-purple-700",
        bg: "bg-purple-50/70 dark:bg-purple-900/15 border border-purple-200 border-dashed dark:border-purple-800",
      }}
      defaultExpanded={autoExpand}
      detailsBorderStyle="dashed"
    />
  );
}

interface TodoMessageComponentProps {
  message: TodoMessage;
}

export function TodoMessageComponent({ message }: TodoMessageComponentProps) {
  const getStatusIcon = (status: TodoItem["status"]) => {
    switch (status) {
      case "completed":
        return { icon: "✅", label: "Completed" };
      case "in_progress":
        return { icon: "🔄", label: "In progress" };
      case "pending":
      default:
        return { icon: "⏳", label: "Pending" };
    }
  };

  const getStatusColor = (status: TodoItem["status"]) => {
    switch (status) {
      case "completed":
        return "text-green-700 dark:text-green-400";
      case "in_progress":
        return "text-blue-700 dark:text-blue-400";
      case "pending":
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  return (
    <MessageContainer
      alignment="left"
      colorScheme="bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold opacity-90 text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <div
            className="w-4 h-4 bg-amber-500 dark:bg-amber-600 rounded-full flex items-center justify-center text-white text-xs"
            aria-hidden="true"
          >
            📋
          </div>
          Todo List Updated
        </div>
        <TimestampComponent
          timestamp={message.timestamp}
          className="text-xs opacity-70 text-amber-600 dark:text-amber-400"
        />
      </div>

      <div className="space-y-1">
        {message.todos.map((todo, index) => {
          const statusIcon = getStatusIcon(todo.status);
          return (
            <div key={index} className="flex items-start gap-2">
              <span
                className="text-sm flex-shrink-0 mt-0.5"
                aria-label={statusIcon.label}
              >
                {statusIcon.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${getStatusColor(todo.status)}`}>
                  {todo.content}
                </div>
                {todo.status === "in_progress" && (
                  <div className="text-xs text-amber-600 dark:text-amber-500 italic">
                    {todo.activeForm}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-amber-700 dark:text-amber-400">
        {message.todos.filter((t) => t.status === "completed").length} of{" "}
        {message.todos.length} completed
      </div>
    </MessageContainer>
  );
}

export function LoadingComponent({
  assistantDisplayName,
  assistantAvatarText,
}: {
  assistantDisplayName: string;
  assistantAvatarText: string;
}) {
  return (
    <MessageContainer alignment="left" colorScheme="panel-surface border">
      <div
        className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-90"
        style={{ color: "var(--text-secondary)" }}
      >
        <span
          className="h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px]"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--surface-border)",
          }}
        >
          {assistantAvatarText}
        </span>
        <span>{assistantDisplayName}</span>
      </div>
      <div
        className="flex items-center gap-2 text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
        <span className="animate-pulse">思考中...</span>
      </div>
    </MessageContainer>
  );
}
