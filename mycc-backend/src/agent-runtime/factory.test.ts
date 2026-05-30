import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';
import { E2bClaudeAgentSdkRuntime } from './e2b-claude-agent-sdk-runtime.js';
import { E2bClaudeCliRuntime } from './e2b-claude-cli-runtime.js';
import { createAgentRuntime, describeAgentRuntimeConfig } from './factory.js';

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

  it('creates E2B Claude Agent SDK runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'e2b-claude-agent-sdk' });

    expect(runtime).toBeInstanceOf(E2bClaudeAgentSdkRuntime);
  });

  it('rejects unsupported runtime kinds', () => {
    expect(() => createAgentRuntime({ kind: 'unknown-runtime' }))
      .toThrow('Unsupported agent runtime: unknown-runtime');
  });

  it('describes the E2B Agent SDK runtime and CCR provider without secrets', () => {
    const config = describeAgentRuntimeConfig({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
      MYCC_CCR_API_KEY: 'ccr-secret',
    });

    expect(config).toEqual({
      kind: 'e2b-claude-agent-sdk',
      executionEnvironment: 'e2b',
      usesAgentSdk: true,
      usesCodeServerWorkspace: true,
      claudeProvider: {
        provider: 'ccr',
        baseUrlConfigured: true,
        baseUrlSource: 'MYCC_CCR_BASE_URL',
        credentialConfigured: true,
        credentialSource: 'MYCC_CCR_API_KEY',
        credentialTarget: 'ANTHROPIC_API_KEY',
      },
    });
    expect(JSON.stringify(config)).not.toContain('ccr-secret');
    expect(JSON.stringify(config)).not.toContain('ccr.example.test');
  });
});
