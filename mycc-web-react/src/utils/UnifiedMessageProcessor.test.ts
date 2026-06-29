import { describe, expect, it, vi } from "vitest";
import { UnifiedMessageProcessor } from "./UnifiedMessageProcessor";
import { convertConversationHistory } from "./messageConversion";
import type { AllMessage, ChatMessage, TimestampedSDKMessage } from "../types";

const verboseSkillText = [
  "Base directory for this skill: /home/mycc/.claude/skills/browser-use",
  "",
  "# 道友 AI 助理浏览器",
  "",
  "道友 AI 的云端工作间预装浏览器自动化能力。",
  "",
  "ARGUMENTS: https://example.com/",
].join("\n");

function createUserMessage(content: unknown): TimestampedSDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
    timestamp: "2026-06-02T00:00:00.000Z",
  } as TimestampedSDKMessage;
}

function createAssistantMessage(content: unknown[]): TimestampedSDKMessage {
  return {
    type: "assistant",
    message: {
      id: "msg_thinking_test",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
      },
    },
    parent_tool_use_id: null,
    session_id: "session-thinking-test",
    timestamp: "2026-06-02T00:00:00.000Z",
  } as TimestampedSDKMessage;
}

describe("UnifiedMessageProcessor internal skill details", () => {
  it("hides internal task lifecycle system events during streaming", () => {
    const processor = new UnifiedMessageProcessor();
    const messages: AllMessage[] = [];

    processor.processMessage(
      ({
        type: "system",
        subtype: "task_started",
        session_id: "session-task",
        message: "Task started",
      } as unknown as TimestampedSDKMessage),
      {
        addMessage: (message) => messages.push(message),
      },
      { isStreaming: true },
    );

    expect(messages).toEqual([]);
  });

  it("does not raise local permission UI when bypassPermissions is active", () => {
    const processor = new UnifiedMessageProcessor();
    const messages: AllMessage[] = [];
    const onPermissionError = vi.fn();
    const onAbortRequest = vi.fn();

    processor.processMessage(
      createAssistantMessage([
        {
          type: "tool_use",
          id: "tool-bash-1",
          name: "Bash",
          input: { command: "npm run typecheck" },
        },
      ]),
      {
        addMessage: (message) => messages.push(message),
      },
      { isStreaming: true },
    );

    processor.processMessage(
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-bash-1",
              content: "User rejected permissions to use Bash",
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: null,
        timestamp: "2026-06-02T00:00:00.000Z",
      } as TimestampedSDKMessage,
      {
        addMessage: (message) => messages.push(message),
        onPermissionError,
        onAbortRequest,
        permissionMode: "bypassPermissions",
      },
      { isStreaming: true },
    );

    expect(onPermissionError).not.toHaveBeenCalled();
    expect(onAbortRequest).not.toHaveBeenCalled();
  });

  it("hides verbose skill runtime text during streaming conversion", () => {
    const processor = new UnifiedMessageProcessor();
    const messages: AllMessage[] = [];

    processor.processMessage(
      createUserMessage([{ type: "text", text: verboseSkillText }]),
      {
        addMessage: (message) => messages.push(message),
      },
      { isStreaming: true },
    );

    expect(messages).toEqual([]);
  });

  it("hides verbose skill runtime text when loading history", () => {
    const messages = convertConversationHistory([
      createUserMessage([{ type: "text", text: verboseSkillText }]),
    ]);

    expect(messages).toEqual([]);
  });

  it("keeps ordinary user text in history", () => {
    const messages = convertConversationHistory([
      createUserMessage("请打开 https://example.com/"),
    ]);

    expect(messages).toMatchObject([
      {
        type: "chat",
        role: "user",
        content: "请打开 https://example.com/",
      },
    ]);
  });

  it("hides assistant thinking details when loading history", () => {
    const messages = convertConversationHistory([
      createAssistantMessage([
        {
          type: "thinking",
          thinking: "I need analyze private internal reasoning before acting.",
        },
        {
          type: "text",
          text: "我来继续处理。",
        },
      ]),
    ]);

    expect(messages).toMatchObject([
      {
        type: "chat",
        role: "assistant",
        content: "我来继续处理。",
      },
    ]);
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        type: "thinking",
      }),
    );
  });

  it("hides assistant thinking details during streaming conversion", () => {
    const processor = new UnifiedMessageProcessor();
    const messages: AllMessage[] = [];
    let currentAssistantMessage: ChatMessage | null = null;

    processor.processMessage(
      createAssistantMessage([
        {
          type: "thinking",
          thinking: "I need analyze private internal reasoning before acting.",
        },
        {
          type: "text",
          text: "我来继续处理。",
        },
      ]),
      {
        addMessage: (message) => messages.push(message),
        currentAssistantMessage,
        setCurrentAssistantMessage: (message) => {
          currentAssistantMessage = message;
        },
        updateLastMessage: (content) => {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.type === "chat") {
            lastMessage.content = content;
          }
        },
      },
      { isStreaming: true },
    );

    expect(messages).toMatchObject([
      {
        type: "chat",
        role: "assistant",
        content: "我来继续处理。",
      },
    ]);
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        type: "thinking",
      }),
    );
  });
});
