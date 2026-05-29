export type AgentRuntimeKind = 'remote-claude' | 'claude-agent-sdk' | 'e2b-claude-cli';

export interface AgentChatParams {
  userId?: number;
  message: string;
  sessionId?: string;
  cwd: string;
  linuxUser: string;
  images?: Array<{ data: string; mediaType: string }>;
}

export interface AgentRuntimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentRuntime {
  chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent>;
}
