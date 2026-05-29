import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';
import { E2bClaudeCliRuntime } from './e2b-claude-cli-runtime.js';
import { createAgentRuntime } from './factory.js';

describe('createAgentRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses remote claude runtime by default', () => {
    const runtime = createAgentRuntime();

    expect(runtime).toBeInstanceOf(RemoteClaudeAdapter);
  });

  it('uses runtime kind from environment', () => {
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'remote-claude');

    const runtime = createAgentRuntime();

    expect(runtime).toBeInstanceOf(RemoteClaudeAdapter);
  });

  it('creates claude agent sdk runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'claude-agent-sdk' });

    expect(runtime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('uses claude agent sdk runtime from environment', () => {
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'claude-agent-sdk');

    const runtime = createAgentRuntime();

    expect(runtime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('creates E2B Claude CLI runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'e2b-claude-cli' });

    expect(runtime).toBeInstanceOf(E2bClaudeCliRuntime);
  });

  it('rejects unsupported runtime kinds', () => {
    expect(() => createAgentRuntime({ kind: 'unknown-runtime' }))
      .toThrow('Unsupported agent runtime: unknown-runtime');
  });
});
