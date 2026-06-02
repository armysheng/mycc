import type { AgentChatParams } from './types.js';

export const AGENT_RUNNER_REQUEST_KIND = 'mycc.agent-runner.request';
export const AGENT_RUNNER_REQUEST_VERSION = 1;

type AgentRunnerImage = NonNullable<AgentChatParams['images']>[number];

export type ClaudeAgentRunnerRequest = {
  kind: typeof AGENT_RUNNER_REQUEST_KIND;
  version: typeof AGENT_RUNNER_REQUEST_VERSION;
  runner: 'claude-agent-sdk';
  input: {
    message: string;
    images?: AgentRunnerImage[];
  };
  execution: {
    allowedTools: string[];
    cwd: string;
    includePartialMessages: boolean;
    model: string;
    permissionMode: string;
    sessionId?: string;
  };
};

export function buildClaudeAgentRunnerRequest(
  params: AgentChatParams,
  options: {
    allowedTools: string[];
    cwd: string;
    includePartialMessages: boolean;
    model: string;
    permissionMode: string;
  },
): ClaudeAgentRunnerRequest {
  return {
    kind: AGENT_RUNNER_REQUEST_KIND,
    version: AGENT_RUNNER_REQUEST_VERSION,
    runner: 'claude-agent-sdk',
    input: {
      message: params.message,
      ...(params.images && params.images.length > 0
        ? { images: params.images }
        : {}),
    },
    execution: {
      allowedTools: options.allowedTools,
      cwd: options.cwd,
      includePartialMessages: options.includePartialMessages,
      model: options.model,
      permissionMode: options.permissionMode,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    },
  };
}

export function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
