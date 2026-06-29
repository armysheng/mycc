import { useRef, useEffect, useState } from "react";
import type { AllMessage } from "../../types";
import {
  isChatMessage,
  isSystemMessage,
  isToolMessage,
  isToolResultMessage,
  isPlanMessage,
  isThinkingMessage,
  isTodoMessage,
  isInternalSystemTelemetryMessage,
} from "../../types";
import {
  ChatMessageComponent,
  SystemMessageComponent,
  ToolMessageComponent,
  ToolResultMessageComponent,
  PlanMessageComponent,
  ThinkingMessageComponent,
  TodoMessageComponent,
} from "../MessageComponents";
import { CollapsibleDetails } from "../messages/CollapsibleDetails";
import { useSettings } from "../../hooks/useSettings";
import { getToolActivityLabel } from "../../utils/toolDisplayMapper";
import { containsRuntimeErrorDetails } from "../../api/userFacingError";
// import { UI_CONSTANTS } from "../../utils/constants"; // Unused for now

interface ChatMessagesProps {
  messages: AllMessage[];
  isLoading: boolean;
  assistantDisplayName: string;
  assistantAvatarText: string;
  onReEditMessage?: (content: string) => void;
  onRetryMessage?: (content: string) => void;
}

type ToolProcessMessage = Extract<AllMessage, { type: "tool" | "tool_result" }>;
type DisplayItem =
  | { type: "message"; message: AllMessage; index: number }
  | { type: "tool_process"; messages: ToolProcessMessage[]; index: number };
type ConversationActivity = {
  label: string;
  details: string;
  badge: string;
};
const PROCESS_ERROR_TEXT =
  "这次操作没有跑通。可以直接重试，或让我换个方式继续。";
const PROCESS_DETAIL_RECORDED_TEXT = "处理动态已记录。";

export function ChatMessages({
  messages,
  isLoading,
  assistantDisplayName,
  assistantAvatarText,
  onReEditMessage,
  onRetryMessage,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { showToolCalls, autoExpandThinking, fontSize } = useSettings();

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (messagesEndRef.current && messagesEndRef.current.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Check if user is near bottom of messages (unused but kept for future use)
  // const isNearBottom = () => {
  //   const container = messagesContainerRef.current;
  //   if (!container) return true;

  //   const { scrollTop, scrollHeight, clientHeight } = container;
  //   return (
  //     scrollHeight - scrollTop - clientHeight <
  //     UI_CONSTANTS.NEAR_BOTTOM_THRESHOLD_PX
  //   );
  // };

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const renderMessage = (message: AllMessage, index: number) => {
    // Use timestamp as key for stable rendering, fallback to index if needed
    const key = `${message.timestamp}-${index}`;

    if (isSystemMessage(message)) {
      return <SystemMessageComponent key={key} message={message} />;
    } else if (isToolMessage(message)) {
      return <ToolMessageComponent key={key} message={message} />;
    } else if (isToolResultMessage(message)) {
      return <ToolResultMessageComponent key={key} message={message} />;
    } else if (isPlanMessage(message)) {
      return <PlanMessageComponent key={key} message={message} />;
    } else if (isThinkingMessage(message)) {
      return (
        <ThinkingMessageComponent
          key={key}
          message={message}
          autoExpand={autoExpandThinking}
        />
      );
    } else if (isTodoMessage(message)) {
      return <TodoMessageComponent key={key} message={message} />;
    } else if (isChatMessage(message)) {
      const retryContent =
        message.role === "assistant" && onRetryMessage
          ? findPreviousUserChatContent(visibleMessages, index)
          : undefined;
      return (
        <ChatMessageComponent
          key={key}
          message={message}
          assistantDisplayName={assistantDisplayName}
          assistantAvatarText={assistantAvatarText}
          onReEditMessage={onReEditMessage}
          onRetryMessage={onRetryMessage}
          retryContent={retryContent}
          retryDisabled={isLoading}
        />
      );
    }
    return null;
  };

  const visibleMessages = (showToolCalls
    ? messages
    : messages.filter(
        (message) => !isToolMessage(message) && !isToolResultMessage(message),
      )).filter(
        (message) =>
          !isInternalSystemTelemetryMessage(message) &&
          !(isLoading && (isToolMessage(message) || isToolResultMessage(message))),
      );
  const displayItems = buildDisplayItems(visibleMessages);

  const fontSizeClass =
    fontSize === "sm"
      ? "text-sm"
      : fontSize === "lg"
        ? "text-base"
      : "text-[15px]";
  const activity = buildConversationActivity(messages, isLoading);

  return (
    <div
      ref={messagesContainerRef}
      className={`flex-1 overflow-y-auto border p-3 sm:p-5 mb-3 sm:mb-5 rounded-[16px] shadow-[var(--shadow-sm)] flex flex-col ${fontSizeClass}`}
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--surface-border)",
      }}
    >
      {visibleMessages.length === 0 && !isLoading ? (
        <EmptyState assistantDisplayName={assistantDisplayName} />
      ) : (
        <>
          {/* Spacer div to push messages to the bottom */}
          <div className="flex-1" aria-hidden="true"></div>
          {displayItems.map((item) => {
            if (item.type === "tool_process") {
              return (
                <ToolProcessGroup
                  key={`tool-process-${item.index}`}
                  messages={item.messages}
                />
              );
            }
            return renderMessage(item.message, item.index);
          })}
          {activity && <ConversationActivityPanel activity={activity} />}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}

function findPreviousUserChatContent(
  messages: AllMessage[],
  startIndex: number,
): string | undefined {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isChatMessage(message) && message.role === "user") {
      return message.content;
    }
  }
  return undefined;
}

function buildDisplayItems(messages: AllMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let processMessages: ToolProcessMessage[] = [];
  let processStartIndex = 0;

  const flushProcess = () => {
    if (processMessages.length === 0) return;
    items.push({
      type: "tool_process",
      messages: processMessages,
      index: processStartIndex,
    });
    processMessages = [];
  };

  messages.forEach((message, index) => {
    if (isToolMessage(message) || isToolResultMessage(message)) {
      if (processMessages.length === 0) {
        processStartIndex = index;
      }
      processMessages.push(message);
      return;
    }

    flushProcess();
    items.push({ type: "message", message, index });
  });

  flushProcess();
  return items;
}

function buildConversationActivity(
  messages: AllMessage[],
  isLoading: boolean,
): ConversationActivity | null {
  if (!isLoading) return null;
  const processMessages = messages.filter(
    (message): message is ToolProcessMessage =>
      isToolMessage(message) || isToolResultMessage(message),
  );
  const recentProcessMessages = processMessages.slice(-8);

  const latestToolMessage = [...recentProcessMessages]
    .reverse()
    .find(isToolMessage);
  if (latestToolMessage) {
    return {
      label: summarizeProcessMessage(latestToolMessage),
      details: buildProcessDetails(recentProcessMessages),
      badge: `${recentProcessMessages.length} 项`,
    };
  }

  const latestConversationText = findLatestVisibleText(messages);
  if (!latestConversationText) {
    return {
      label: "正在思考",
      details: "助理正在准备下一步。",
      badge: "进行中",
    };
  }
  return {
    label: "正在理解请求",
    details: latestConversationText,
    badge: "进行中",
  };
}

function findLatestVisibleText(messages: AllMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isChatMessage(message) && message.content.trim()) {
      return message.content.trim();
    }
    if (isTodoMessage(message)) {
      const activeTodo = message.todos.find((todo) => todo.status === "in_progress");
      if (activeTodo?.activeForm) return activeTodo.activeForm;
    }
  }
  return null;
}

function ConversationActivityPanel({
  activity,
}: {
  activity: ConversationActivity;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-3 flex justify-start pl-10 sm:pl-12" aria-live="polite">
      <div
        className="mycc-processing-surface max-w-full"
        data-expanded={isExpanded ? "true" : "false"}
      >
        <button
          type="button"
          className="group mycc-activity-trigger"
          aria-expanded={isExpanded}
          aria-label={`查看处理详情：${activity.label}`}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          <span className="mycc-activity-rail" aria-hidden="true" />
          <span className="mycc-thinking-text">{activity.label}</span>
          <span className="mycc-activity-meta">
            {isExpanded ? "收起" : "详情"}
          </span>
        </button>
        {isExpanded && (
          <pre className="mycc-activity-details">
            {activity.details}
          </pre>
        )}
      </div>
    </div>
  );
}

function ToolProcessGroup({ messages }: { messages: ToolProcessMessage[] }) {
  const details = buildProcessDetails(messages);
  const label = summarizeProcessMessage(
    messages[messages.length - 1] ?? messages[0],
  );

  return (
    <CollapsibleDetails
      label={label}
      details={details}
      badge={`过程 · ${messages.length} 项`}
      icon={<span className="bg-slate-400 dark:bg-slate-500">•</span>}
      colorScheme={{
        header: "text-slate-700 dark:text-slate-200",
        content: "text-slate-600 dark:text-slate-300",
        border: "border-slate-200 dark:border-slate-700",
        bg: "bg-slate-50/85 dark:bg-slate-900/35",
      }}
      showPreview={false}
      variant="pill"
    />
  );
}

function buildProcessDetails(messages: ToolProcessMessage[]): string {
  return messages
    .map((message, index) => {
      if (isToolMessage(message)) {
        return [
          `${index + 1}. ${summarizeProcessMessage(message)}`,
          getUserFacingProcessContent(message.content, false),
        ]
          .filter(Boolean)
          .join("\n");
      }

      return [
        `${index + 1}. ${summarizeProcessMessage(message)}`,
        getUserFacingProcessContent(message.content, true),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function summarizeProcessMessage(message: ToolProcessMessage): string {
  if (isToolMessage(message)) {
    return cleanActivityLabel(getToolActivityLabel(message.toolName, message.input));
  }
  const source = message.summary || message.content;
  return compactText(getUserFacingProcessContent(source, true), 22);
}

function cleanActivityLabel(label: string): string {
  return label.replace(/\.{2,}$/u, "").trim();
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, maxLength).join("")}…`;
}

function getUserFacingProcessContent(
  value: string,
  isResult: boolean,
): string {
  const cleaned = value.trim();
  if (!cleaned) return "";
  if (containsRuntimeErrorDetails(cleaned)) {
    return isResult ? PROCESS_ERROR_TEXT : PROCESS_DETAIL_RECORDED_TEXT;
  }
  return cleaned;
}

function EmptyState({ assistantDisplayName }: { assistantDisplayName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-center text-[var(--text-secondary)]">
      <div>
        <div className="mx-auto mb-5 h-14 w-14 rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-hidden="true">
        </div>
        <p className="text-base font-medium">今天要 {assistantDisplayName} 帮你做什么？</p>
        <p className="text-sm mt-2 opacity-80">
          交代一个任务、继续上次的事，或者让助理整理当前项目状态。
        </p>
      </div>
    </div>
  );
}
