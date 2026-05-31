export type AgentRuntimeKind = 'remote-claude' | 'claude-agent-sdk' | 'e2b-claude-cli' | 'e2b-claude-agent-sdk';
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

export interface AgentChatParams {
  userId?: number;
  message: string;
  sessionId?: string;
  cwd: string;
  linuxUser: string;
  permissionMode?: AgentPermissionMode;
  images?: Array<{ data: string; mediaType: string }>;
}

export interface AgentRuntimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentRuntime {
  chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent>;
}
