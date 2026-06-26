import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { E2bClaudeAgentSdkRuntime } from './e2b-claude-agent-sdk-runtime.js';
import type { IdeSessionStore, StoredIdeSession } from '../ide/session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  template: 'mycc-assistant-sandbox-dev',
  linuxUser: 'mycc',
  workspaceDir: '/home/mycc/workspace',
  sandboxId: 'sbx_123',
  codeServerPid: 1234,
  host: '18080-sbx_123.e2b.app',
  trafficAccessToken: 'secret-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

function createStore(session: StoredIdeSession | null): IdeSessionStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    findReusableByUser: vi.fn().mockResolvedValue(session),
    findExpiredRunning: vi.fn().mockResolvedValue([]),
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('E2bClaudeAgentSdkRuntime', () => {
  beforeEach(() => {
    vi.stubEnv('MYCC_IDE_PROVIDER', 'e2b');
    vi.stubEnv('MYCC_CCR_BASE_URL', 'http://127.0.0.1:3456');
    vi.stubEnv('MYCC_CCR_AUTH_TOKEN', 'ccr-auth-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs the Agent SDK bridge inside the reusable E2B IDE sandbox workspace', async () => {
    vi.stubEnv('MYCC_CCR_BASE_URL', 'http://127.0.0.1:3456');
    vi.stubEnv('MYCC_CCR_AUTH_TOKEN', 'ccr-auth-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'stale-anthropic-api-key');
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"system","session_id":"session-1","model":"claude-opus-4-7"}\n');
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello from sdk',
      sessionId: 'session-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'system', session_id: 'session-1', model: 'claude-opus-4-7' },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' },
    ]);
    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        envs: expect.objectContaining({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
          ANTHROPIC_AUTH_TOKEN: 'ccr-auth-token',
          CLAUDE_CONFIG_DIR: '/home/mycc/.claude',
          HOME: '/home/mycc',
          MYCC_AGENT_REQUEST_FILE: expect.stringMatching(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/),
        }),
      }),
    );
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const sdkEnv = bridgeCall?.[2].envs || {};
    const request = readWrittenJsonRequest(runCommand, sdkEnv.MYCC_AGENT_REQUEST_FILE);
    expect(request).toEqual(expect.objectContaining({
      kind: 'mycc.agent-runner.request',
      version: 1,
      runner: 'claude-agent-sdk',
      input: {
        message: 'hello from sdk',
      },
      execution: expect.objectContaining({
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'],
        cwd: '/home/mycc/workspace',
        includePartialMessages: false,
        model: 'claude-opus-4-7',
        permissionMode: 'bypassPermissions',
        sessionId: 'session-1',
      }),
    }));
    expect(JSON.stringify(request)).not.toContain('ccr-auth-token');
    expect(sdkEnv).not.toHaveProperty('MYCC_AGENT_PROMPT_B64');
    expect(sdkEnv).not.toHaveProperty('MYCC_AGENT_SESSION_ID');
    expect(sdkEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('uses Agent SDK specific provider env before shared Claude aliases', async () => {
    vi.stubEnv('MYCC_AGENT_SDK_BASE_URL', 'https://agent-sdk.example.test/v1');
    vi.stubEnv('MYCC_AGENT_SDK_AUTH_TOKEN', 'sdk-token');
    vi.stubEnv('MYCC_CLAUDE_BASE_URL', 'https://claude-proxy.example.test/v1');
    vi.stubEnv('MYCC_CLAUDE_AUTH_TOKEN', 'claude-token');
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'hello from sdk env',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    expect(bridgeCall?.[2].envs).toEqual(expect.objectContaining({
      ANTHROPIC_BASE_URL: 'https://agent-sdk.example.test',
      ANTHROPIC_AUTH_TOKEN: 'sdk-token',
    }));
  });

  it('passes image attachments to the Agent SDK bridge', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: '看一下截图',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      images: [
        {
          data: 'iVBORw==',
          mediaType: 'image/png',
        },
      ],
    }));

    expect(events).toEqual([
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' },
    ]);
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const sdkEnv = bridgeCall?.[2].envs || {};
    const request = readWrittenJsonRequest(runCommand, sdkEnv.MYCC_AGENT_REQUEST_FILE);
    expect(request.input.images).toEqual([
      {
        data: 'iVBORw==',
        mediaType: 'image/png',
      },
    ]);
  });

  it('normalizes legacy dot Claude model ids before writing the bridge request', async () => {
    vi.stubEnv('MYCC_E2B_AGENT_SDK_MODEL', 'claude-opus-4.7');
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'hello from legacy model env',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const request = readWrittenJsonRequest(runCommand, bridgeCall?.[2].envs?.MYCC_AGENT_REQUEST_FILE);
    expect(request.execution.model).toBe('claude-opus-4-7');
  });

  it('stores large bridge payloads in sandbox files instead of oversized process envs', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });
    const largeMessage = '请整理这段长上下文：\n' + 'context '.repeat(12_000);

    const events = await collect(runtime.chat({
      userId: 42,
      message: largeMessage,
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' },
    ]);
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    expect(bridgeCall).toBeDefined();
    const sdkEnv = bridgeCall?.[2].envs || {};
    expect(sdkEnv).toHaveProperty('MYCC_AGENT_REQUEST_FILE');
    expect(sdkEnv.MYCC_AGENT_REQUEST_FILE).toMatch(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/);
    expect(sdkEnv).not.toHaveProperty('MYCC_AGENT_PROMPT_B64');
    expect(sdkEnv).not.toHaveProperty('MYCC_AGENT_PROMPT_B64_FILE');

    const payloadWriteCalls = runCommand.mock.calls.filter(([, command]) => {
      return String(command).includes(String(sdkEnv.MYCC_AGENT_REQUEST_FILE));
    });
    expect(payloadWriteCalls.length).toBeGreaterThan(1);
    for (const [, command, options] of payloadWriteCalls) {
      expect(String(command).length).toBeLessThan(25_000);
      expect(options).toEqual(expect.objectContaining({ cwd: '/home/mycc/workspace' }));
    }
    const request = readWrittenJsonRequest(runCommand, sdkEnv.MYCC_AGENT_REQUEST_FILE);
    expect(request.input.message).toBe(largeMessage);
  });

  it('retries a stale Claude resume once without exposing the failed resume events', async () => {
    let bridgeRuns = 0;
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        bridgeRuns += 1;
      }
      if (String(command).includes('bridge.mjs') && bridgeRuns === 1) {
        await options.onStdout('{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"stale-session"}\n');
        return { exitCode: 1, stdout: '', stderr: 'resume failed' };
      }

      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"system","session_id":"fresh-session","model":"claude-opus-4-7"}\n');
        await options.onStdout('{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n');
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"fresh-session"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'reply ok',
      sessionId: 'stale-session',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'system', session_id: 'fresh-session', model: 'claude-opus-4-7' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'fresh-session' },
    ]);
    const bridgeCalls = runCommand.mock.calls.filter(([, command]) => String(command).includes('bridge.mjs'));
    expect(bridgeCalls).toHaveLength(2);
    const staleRequest = readWrittenJsonRequest(runCommand, bridgeCalls[0][2].envs.MYCC_AGENT_REQUEST_FILE);
    const freshRequest = readWrittenJsonRequest(runCommand, bridgeCalls[1][2].envs.MYCC_AGENT_REQUEST_FILE);
    expect(staleRequest.execution.sessionId).toBe('stale-session');
    expect(freshRequest.execution).not.toHaveProperty('sessionId');
  });

  it('maps a user project cwd into the same path under the sandbox workspace root', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'work in demo',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        cwd: '/home/mycc/workspace/demo',
        envs: expect.objectContaining({
          MYCC_AGENT_REQUEST_FILE: expect.stringMatching(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/),
        }),
      }),
    );
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const request = readWrittenJsonRequest(runCommand, bridgeCall?.[2].envs?.MYCC_AGENT_REQUEST_FILE);
    expect(request.execution.cwd).toBe('/home/mycc/workspace/demo');
  });

  it('creates the sandbox project cwd before launching the Agent SDK bridge', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'open a browser in demo',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      runningSession,
      "mkdir -p -- '/home/mycc/workspace/demo'",
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
      }),
    );
    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        cwd: '/home/mycc/workspace/demo',
      }),
    );
  });

  it('lets E2B override the Agent SDK tool list for sandbox-specific helpers', async () => {
    vi.stubEnv('MYCC_E2B_AGENT_SDK_ALLOWED_TOOLS', 'Read,Bash');
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'open a browser',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        envs: expect.objectContaining({
          MYCC_AGENT_REQUEST_FILE: expect.stringMatching(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/),
        }),
      }),
    );
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const request = readWrittenJsonRequest(runCommand, bridgeCall?.[2].envs?.MYCC_AGENT_REQUEST_FILE);
    expect(request.execution.allowedTools).toEqual(['Read', 'Bash']);
  });

  it('requires chat routes to pass userId for E2B sandbox lookup', async () => {
    const runCommand = vi.fn();
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'E2B Agent SDK runtime requires userId' },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('marks a stale reusable E2B session stopped when bridge execution cannot find the sandbox', async () => {
    const store = createStore(runningSession);
    const runCommand = vi.fn().mockRejectedValue(new Error('sandbox not found'));
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: store,
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'sandbox not found' },
    ]);
    expect(store.set).toHaveBeenCalledWith({
      ...runningSession,
      status: 'stopped',
    });
  });

  it('returns product-facing copy for low-level Agent SDK bridge failures', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command) => {
      if (String(command).includes('bridge.mjs')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'selected model may not exist or you may not have access to it; /v1/messages failed',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: '这次操作没有跑通。可以直接重试，或让我换个方式继续。' },
    ]);
    expect(JSON.stringify(events)).not.toContain('selected model');
    expect(JSON.stringify(events)).not.toContain('/v1/messages');
  });

  it('rejects unsupported Agent SDK permission modes before running bridge', async () => {
    vi.stubEnv('MYCC_E2B_AGENT_SDK_FORCE_BYPASS_PERMISSIONS', 'false');
    vi.stubEnv('MYCC_AGENT_SDK_PERMISSION_MODE', 'writeEverything');
    const runCommand = vi.fn();
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'Unsupported E2B Agent SDK permission mode: writeEverything' },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('forces bypassPermissions for the sandbox bridge by default', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
    }));

    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        envs: expect.objectContaining({
          MYCC_AGENT_REQUEST_FILE: expect.stringMatching(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/),
        }),
      }),
    );
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const request = readWrittenJsonRequest(runCommand, bridgeCall?.[2].envs?.MYCC_AGENT_REQUEST_FILE);
    expect(request.execution.permissionMode).toBe('bypassPermissions');
  });

  it('allows disabling forced bypass mode for local debugging', async () => {
    vi.stubEnv('MYCC_E2B_AGENT_SDK_FORCE_BYPASS_PERMISSIONS', 'false');
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
    }));

    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({
        envs: expect.objectContaining({
          MYCC_AGENT_REQUEST_FILE: expect.stringMatching(/^\/tmp\/mycc-agent-runtime\/.+\/request\.json$/),
        }),
      }),
    );
    const bridgeCall = runCommand.mock.calls.find(([, command]) => String(command).includes('bridge.mjs'));
    const request = readWrittenJsonRequest(runCommand, bridgeCall?.[2].envs?.MYCC_AGENT_REQUEST_FILE);
    expect(request.execution.permissionMode).toBe('plan');
  });

  it('creates and stores an E2B IDE sandbox when chat starts before Remote IDE opens', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const store = createStore(null);
    const startCodeServer = vi.fn().mockResolvedValue({
      provider: 'e2b',
      sandboxId: 'sbx_new',
      codeServerPid: 4321,
      host: '18080-sbx_new.e2b.app',
      trafficAccessToken: 'new-secret-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2099-05-29T14:00:00.000Z',
    });
    const runCommand = vi.fn().mockImplementation(async (_session, command, options) => {
      if (String(command).includes('bridge.mjs')) {
        await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-2"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeAgentSdkRuntime({
      sessionStore: store,
      e2bProvider: { startCodeServer, runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace/demo',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-2' },
    ]);
    expect(startCodeServer).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'e2b',
      userId: 42,
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      accessMode: 'mycc-proxy',
    }));
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'e2b',
      sandboxId: 'sbx_new',
      userId: 42,
      status: 'running',
      proxyToken: expect.any(String),
    }));
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sbx_new' }),
      'cd /opt/mycc-agent-runtime && node bridge.mjs',
      expect.objectContaining({ cwd: '/home/mycc/workspace/demo' }),
    );
  });
});

function readWrittenJsonRequest(runCommand: ReturnType<typeof vi.fn>, requestFile: unknown): any {
  expect(typeof requestFile).toBe('string');
  const chunks = runCommand.mock.calls
    .map(([, command]) => String(command))
    .filter((command) => command.includes(String(requestFile)) && command.startsWith('printf %s '))
    .map((command) => {
      const match = command.match(/^printf %s '([^']*)' >> /);
      expect(match).not.toBeNull();
      return match?.[1] ?? '';
    });
  expect(chunks.length).toBeGreaterThan(0);
  return JSON.parse(chunks.join(''));
}
