import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';
import { E2bClaudeAgentSdkRuntime } from './e2b-claude-agent-sdk-runtime.js';
import { E2bClaudeCliRuntime } from './e2b-claude-cli-runtime.js';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { describeClaudeProviderEnv, type ClaudeProviderEnvDescription } from './claude-env.js';
import type { AgentRuntime, AgentRuntimeKind } from './types.js';

export type AgentRuntimeFactoryOptions = {
  kind?: AgentRuntimeKind | string;
};

export type AgentRuntimeConfigDescription = {
  kind: AgentRuntimeKind;
  executionEnvironment: 'vps' | 'local' | 'e2b';
  usesAgentSdk: boolean;
  usesCodeServerWorkspace: boolean;
  claudeProvider: ClaudeProviderEnvDescription;
};

export function createAgentRuntime(options: AgentRuntimeFactoryOptions = {}): AgentRuntime {
  const kind = resolveAgentRuntimeKind(options.kind, process.env);

  switch (kind) {
    case 'claude-agent-sdk':
      return new ClaudeAgentSdkRuntime();
    case 'e2b-claude-cli':
      return new E2bClaudeCliRuntime();
    case 'e2b-claude-agent-sdk':
      return new E2bClaudeAgentSdkRuntime();
    case 'remote-claude':
      return new RemoteClaudeAdapter();
    default:
      throw new Error(`Unsupported agent runtime: ${String(kind)}`);
  }
}

export function describeAgentRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentRuntimeConfigDescription {
  const kind = resolveAgentRuntimeKind(undefined, env);
  return {
    kind,
    executionEnvironment: resolveExecutionEnvironment(kind),
    usesAgentSdk: kind === 'claude-agent-sdk' || kind === 'e2b-claude-agent-sdk',
    usesCodeServerWorkspace: kind === 'e2b-claude-cli' || kind === 'e2b-claude-agent-sdk',
    claudeProvider: describeClaudeProviderEnv(env),
  };
}

function resolveAgentRuntimeKind(
  explicitKind: AgentRuntimeKind | string | undefined,
  env: NodeJS.ProcessEnv,
): AgentRuntimeKind {
  const kind = (explicitKind ?? env.MYCC_AGENT_RUNTIME ?? 'remote-claude').trim();
  if (
    kind === 'remote-claude' ||
    kind === 'claude-agent-sdk' ||
    kind === 'e2b-claude-cli' ||
    kind === 'e2b-claude-agent-sdk'
  ) {
    return kind;
  }
  throw new Error(`Unsupported agent runtime: ${String(kind)}`);
}

function resolveExecutionEnvironment(kind: AgentRuntimeKind): AgentRuntimeConfigDescription['executionEnvironment'] {
  if (kind === 'remote-claude') return 'vps';
  if (kind === 'claude-agent-sdk') return 'local';
  return 'e2b';
}
