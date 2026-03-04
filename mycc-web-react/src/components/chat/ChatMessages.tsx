import { useRef, useEffect } from "react";
import type { AllMessage } from "../../types";
import {
  isChatMessage,
  isSystemMessage,
  isToolMessage,
  isToolResultMessage,
  isPlanMessage,
  isThinkingMessage,
  isTodoMessage,
} from "../../types";
import {
  ChatMessageComponent,
  SystemMessageComponent,
  ToolMessageComponent,
  ToolResultMessageComponent,
  PlanMessageComponent,
  ThinkingMessageComponent,
  TodoMessageComponent,
  LoadingComponent,
} from "../MessageComponents";
import { useSettings } from "../../hooks/useSettings";
// import { UI_CONSTANTS } from "../../utils/constants"; // Unused for now

interface ChatMessagesProps {
  messages: AllMessage[];
  isLoading: boolean;
  assistantDisplayName: string;
  assistantAvatarText: string;
}

export function ChatMessages({
  messages,
  isLoading,
  assistantDisplayName,
  assistantAvatarText,
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
      return (
        <ChatMessageComponent
          key={key}
          message={message}
          assistantDisplayName={assistantDisplayName}
          assistantAvatarText={assistantAvatarText}
        />
      );
    }
    return null;
  };

  const visibleMessages = showToolCalls
    ? messages
    : messages.filter(
        (message) => !isToolMessage(message) && !isToolResultMessage(message),
      );

  const fontSizeClass =
    fontSize === "sm"
      ? "text-sm"
      : fontSize === "lg"
        ? "text-base"
        : "text-[15px]";

  return (
    <div
      ref={messagesContainerRef}
      className={`flex-1 overflow-y-auto border p-3 sm:p-5 mb-3 sm:mb-5 rounded-[16px] shadow-[var(--shadow-sm)] flex flex-col ${fontSizeClass}`}
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--surface-border)",
      }}
    >
      {visibleMessages.length === 0 ? (
        <EmptyState assistantDisplayName={assistantDisplayName} />
      ) : (
        <>
          {/* Spacer div to push messages to the bottom */}
          <div className="flex-1" aria-hidden="true"></div>
          {visibleMessages.map(renderMessage)}
          {isLoading && (
            <LoadingComponent
              assistantDisplayName={assistantDisplayName}
              assistantAvatarText={assistantAvatarText}
            />
          )}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}

function EmptyState({ assistantDisplayName }: { assistantDisplayName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-center text-[var(--text-secondary)]">
      <div>
        <div className="text-5xl mb-5 opacity-60">
          <span role="img" aria-label="chat icon">
            💬
          </span>
        </div>
        <p className="text-base font-medium">开始与 {assistantDisplayName} 对话</p>
        <p className="text-sm mt-2 opacity-80">
          在下方输入内容即可开始
        </p>
      </div>
    </div>
  );
}
