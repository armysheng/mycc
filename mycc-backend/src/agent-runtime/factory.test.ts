import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteClaudeAdapter } from '../adapters/remote-claude-adapter.js';
import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';
import { E2bClaudeAgentSdkRuntime } from './e2b-claude-agent-sdk-runtime.js';
import { E2bClaudeCliRuntime } from './e2b-claude-cli-runtime.js';
import { createAgentRuntime, describeAgentRuntimeConfig, resolveAgentRunStore } from './factory.js';
import { PostgresAgentRunStore } from './run-trace-postgres.js';
import { getDefaultAgentRunStore, TracedAgentRuntime } from './run-trace.js';

describe('createAgentRuntime', () => {
  beforeEach(() => {
    delete process.env.MYCC_AGENT_RUNTIME;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.MYCC_AGENT_RUNTIME;
  });

  it('uses the E2B Claude Agent SDK runtime by default for the product path', () => {
    const runtime = createAgentRuntime({ trace: false });

    expect(runtime).toBeInstanceOf(E2bClaudeAgentSdkRuntime);
  });

  it('uses runtime kind from environment', () => {
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'remote-claude');

    const runtime = createAgentRuntime({ trace: false });

    expect(runtime).toBeInstanceOf(RemoteClaudeAdapter);
  });

  it('creates claude agent sdk runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'claude-agent-sdk', trace: false });

    expect(runtime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('uses claude agent sdk runtime from environment', () => {
    vi.stubEnv('MYCC_AGENT_RUNTIME', 'claude-agent-sdk');

    const runtime = createAgentRuntime({ trace: false });

    expect(runtime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('creates E2B Claude CLI runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'e2b-claude-cli', trace: false });

    expect(runtime).toBeInstanceOf(E2bClaudeCliRuntime);
  });

  it('creates E2B Claude Agent SDK runtime when requested', () => {
    const runtime = createAgentRuntime({ kind: 'e2b-claude-agent-sdk', trace: false });

    expect(runtime).toBeInstanceOf(E2bClaudeAgentSdkRuntime);
  });

  it('wraps runtimes with agent run tracing by default', () => {
    const runtime = createAgentRuntime({ kind: 'claude-agent-sdk' });

    expect(runtime).toBeInstanceOf(TracedAgentRuntime);
    expect((runtime as TracedAgentRuntime).innerRuntime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('lets env disable agent run tracing', () => {
    vi.stubEnv('MYCC_AGENT_RUN_TRACE', 'false');

    const runtime = createAgentRuntime({ kind: 'claude-agent-sdk' });

    expect(runtime).toBeInstanceOf(ClaudeAgentSdkRuntime);
  });

  it('uses Postgres run trace store when configured', () => {
    vi.stubEnv('MYCC_AGENT_RUN_STORE', 'postgres');

    const runtime = createAgentRuntime({ kind: 'claude-agent-sdk' });

    expect(runtime).toBeInstanceOf(TracedAgentRuntime);
    expect((runtime as TracedAgentRuntime).innerRuntime).toBeInstanceOf(ClaudeAgentSdkRuntime);
    expect((runtime as unknown as { runStore: unknown }).runStore).toBeInstanceOf(PostgresAgentRunStore);
  });

  it('exposes the configured run store resolver for runtime APIs', () => {
    expect(resolveAgentRunStore({})).toBe(getDefaultAgentRunStore());
    expect(resolveAgentRunStore({ MYCC_AGENT_RUN_STORE: 'postgres' })).toBeInstanceOf(PostgresAgentRunStore);
  });

  it('rejects unsupported runtime kinds', () => {
    expect(() => createAgentRuntime({ kind: 'unknown-runtime' }))
      .toThrow('Unsupported agent runtime: unknown-runtime');
  });

  it('describes the E2B Agent SDK runtime and direct MyCC Claude provider without secrets', () => {
    const config = describeAgentRuntimeConfig({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
      MYCC_CCR_API_KEY: 'ccr-secret',
      MYCC_CLAUDE_BASE_URL: 'https://zhuji.example.test/v1',
      MYCC_CLAUDE_AUTH_TOKEN: 'zhuji-secret',
    });

    expect(config).toEqual({
      kind: 'e2b-claude-agent-sdk',
      executionEnvironment: 'e2b',
      usesAgentSdk: true,
      usesCodeServerWorkspace: true,
      claudeProvider: {
        provider: 'mycc-claude',
        baseUrlConfigured: true,
        baseUrlSource: 'MYCC_CLAUDE_BASE_URL',
        credentialConfigured: true,
        credentialSource: 'MYCC_CLAUDE_AUTH_TOKEN',
        credentialTarget: 'ANTHROPIC_AUTH_TOKEN',
      },
    });
    expect(JSON.stringify(config)).not.toContain('ccr-secret');
    expect(JSON.stringify(config)).not.toContain('ccr.example.test');
    expect(JSON.stringify(config)).not.toContain('zhuji-secret');
    expect(JSON.stringify(config)).not.toContain('zhuji.example.test');
  });
});
