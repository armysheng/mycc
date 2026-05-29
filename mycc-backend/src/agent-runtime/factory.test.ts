import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
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

  it('rejects unsupported runtime kinds', () => {
    expect(() => createAgentRuntime({ kind: 'claude-agent-sdk' }))
      .toThrow('Unsupported agent runtime: claude-agent-sdk');
  });

  it('rejects unsupported runtime kinds from environment', () => {
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'claude-agent-sdk');

    expect(() => createAgentRuntime())
      .toThrow('Unsupported agent runtime: claude-agent-sdk');
  });
});
