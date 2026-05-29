import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import type { AgentRuntime, AgentRuntimeKind } from './types.js';

export type AgentRuntimeFactoryOptions = {
  kind?: AgentRuntimeKind | string;
};

export function createAgentRuntime(options: AgentRuntimeFactoryOptions = {}): AgentRuntime {
  const kind = (options.kind ?? process.env.MYCC_AGENT_RUNTIME ?? 'remote-claude').trim();

  switch (kind) {
    case 'claude-agent-sdk':
      return new ClaudeAgentSdkRuntime();
    case 'remote-claude':
      return new RemoteClaudeAdapter();
    default:
      throw new Error(`Unsupported agent runtime: ${String(kind)}`);
  }
}
