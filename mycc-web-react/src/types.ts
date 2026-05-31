import type {
  SDKUserMessage,
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKMessage,
  PermissionMode as SDKPermissionMode,
} from "@anthropic-ai/claude-code";

// Chat message for user/assistant interactions (not part of SDKMessage)
export interface ChatMessage {
  type: "chat";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// Error message for streaming errors
export type ErrorMessage = {
  type: "error";
  subtype: "stream_error";
  message: string;
  timestamp: number;
};

// Abort message for aborted operations
export type AbortMessage = {
  type: "system";
  subtype: "abort";
  message: string;
  timestamp: number;
};

// Hooks message for hook execution notifications
export type HooksMessage = {
  type: "system";
  content: string;
  level?: string;
  toolUseID?: string;
};

// System message extending SDK types with timestamp
export type SystemMessage = (
  | SDKSystemMessage
  | SDKResultMessage
  | ErrorMessage
  | AbortMessage
  | HooksMessage
) & {
  timestamp: number;
};

// Tool message for tool usage display
export type ToolMessage = {
  type: "tool";
  content: string;
  toolName?: string;
  input?: Record<string, unknown>;
  timestamp: number;
};

// Tool result message for tool result display
export type ToolResultMessage = {
  type: "tool_result";
  toolName: string;
  content: string;
  summary: string;
  timestamp: number;
  toolUseResult?: unknown; // Contains structured data like structuredPatch, stdout, stderr etc.
};

// Plan approval dialog state
export interface PlanApprovalDialog {
  isOpen: boolean;
  plan: string;
  toolUseId: string;
}

// Plan message type for UI display
export interface PlanMessage {
  type: "plan";
  plan: string;
  toolUseId: string;
  timestamp: number;
}

// Thinking message for Claude's reasoning process
export interface ThinkingMessage {
  type: "thinking";
  content: string;
  timestamp: number;
}

// Todo item structure for TodoWrite tool results
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// Todo message for TodoWrite tool result display
export interface TodoMessage {
  type: "todo";
  todos: TodoItem[];
  timestamp: number;
}

// Thinking content item from Claude SDK
export interface ThinkingContentItem {
  type: "thinking";
  thinking: string;
}

// TimestampedSDKMessage types for conversation history API
// These extend Claude SDK types with timestamp information
type WithTimestamp<T> = T & { timestamp: string };

export type TimestampedSDKUserMessage = WithTimestamp<SDKUserMessage>;
export type TimestampedSDKAssistantMessage = WithTimestamp<SDKAssistantMessage>;
export type TimestampedSDKSystemMessage = WithTimestamp<SDKSystemMessage>;
export type TimestampedSDKResultMessage = WithTimestamp<SDKResultMessage>;

export type TimestampedSDKMessage =
  | TimestampedSDKUserMessage
  | TimestampedSDKAssistantMessage
  | TimestampedSDKSystemMessage
  | TimestampedSDKResultMessage;

export type AllMessage =
  | ChatMessage
  | SystemMessage
  | ToolMessage
  | ToolResultMessage
  | PlanMessage
  | ThinkingMessage
  | TodoMessage;

// Type guard functions
export function isChatMessage(message: AllMessage): message is ChatMessage {
  return message.type === "chat";
}

export function isSystemMessage(message: AllMessage): message is SystemMessage {
  return (
    message.type === "system" ||
    message.type === "result" ||
    message.type === "error"
  );
}

export function isToolMessage(message: AllMessage): message is ToolMessage {
  return message.type === "tool";
}

export function isToolResultMessage(
  message: AllMessage,
): message is ToolResultMessage {
  return message.type === "tool_result";
}

export function isPlanMessage(message: AllMessage): message is PlanMessage {
  return message.type === "plan";
}

export function isThinkingMessage(
  message: AllMessage,
): message is ThinkingMessage {
  return message.type === "thinking";
}

export function isTodoMessage(message: AllMessage): message is TodoMessage {
  return message.type === "todo";
}

// Permission mode types exposed by the UI. Keep labels productized in components.
export type PermissionMode =
  | "bypassPermissions"
  | "default"
  | "plan"
  | "acceptEdits";

// SDK type integration utilities
export function toSDKPermissionMode(uiMode: PermissionMode): SDKPermissionMode {
  return uiMode as SDKPermissionMode;
}

export function fromSDKPermissionMode(
  sdkMode: SDKPermissionMode,
): PermissionMode {
  return sdkMode;
}

// Chat state extensions for permission mode
export interface ChatStatePermissions {
  permissionMode: PermissionMode;
  planApprovalDialog: PlanApprovalDialog | null;
  setPermissionMode: (mode: PermissionMode) => void;
  showPlanApprovalDialog: (plan: string, toolUseId: string) => void;
  closePlanApprovalDialog: () => void;
  approvePlan: () => void;
  rejectPlan: () => void;
}

// Permission mode preference type
export interface PermissionModePreference {
  mode: PermissionMode;
  timestamp: number;
}

// Plan approval error types (simplified, realistic)
export interface PlanApprovalError {
  type: "user_rejected" | "network_error";
  message: string;
  canRetry: boolean;
}

export type PlanApprovalResult =
  | { success: true; sessionId: string }
  | { success: false; error: PlanApprovalError };

// Conversation history types
export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
  customTitle?: string | null;
  firstPrompt?: string;
  modified?: string;
  isActive?: boolean;
}

export interface ConversationHistory {
  sessionId: string;
  messages: TimestampedSDKMessage[];
}

export type AssistantTaskStatus =
  | "recent"
  | "active"
  | "waiting";

export interface AssistantTaskCard {
  id: string;
  source: "conversation";
  status: AssistantTaskStatus;
  title: string;
  messageCount: number;
  totalTokens?: number;
  createdAt?: string;
  updatedAt?: string;
  description?: string;
}

export interface AssistantDeliverableCard {
  id: string;
  kind: "document" | "code_change" | "diff" | "report" | "link" | "preview" | "screenshot" | "log" | "pr" | "dataset";
  title: string;
  source: "current_workspace" | "current_conversation";
  status: "ready" | "pending" | "error";
  description?: string;
  path?: string;
  url?: string;
  updatedAt?: string;
}

export interface AssistantMemorySource {
  kind: "profile" | "project_context" | "runtime_memory";
  label: string;
  status: "available" | "available_when_workspace_running" | "managed_by_runtime" | "missing";
  editable: boolean;
  description: string;
}

export interface AssistantCapabilityCard {
  id: "workbench" | "desktop" | "preview" | "terminal" | string;
  label: string;
  status: "available" | "disabled" | "error";
  description: string;
  actionLabel?: string;
  hidden?: boolean;
}

export interface AssistantHomeData {
  assistant: {
    name: string;
    initialized: boolean;
  };
  tasks: AssistantTaskCard[];
  deliverables: AssistantDeliverableCard[];
  deliverableEmptyState?: {
    title: string;
    description: string;
  };
  memory: {
    sources: AssistantMemorySource[];
  };
  workspace?: {
    status: string;
    label: string;
    description: string;
    expiresAt?: string;
  };
  capabilities: AssistantCapabilityCard[];
  emptyStates?: {
    tasks?: string;
    deliverables?: string;
    memory?: string;
    workspace?: string;
  };
}

// API types
export type StreamResponse =
  | { type: "claude_json"; data: unknown }
  | { type: "error"; error: string }
  | { type: "aborted" }
  | { type: "done"; sessionId?: string }
  | SDKMessage; // Backend returns SDKMessage directly

export interface ChatRequest {
  message: string;
  requestId: string;
  sessionId?: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?: PermissionMode;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface ProjectInfo {
  path: string;
  encodedName: string;
}

// Re-export SDK types
export type {
  SDKMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-code";
