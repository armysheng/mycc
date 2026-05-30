import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2bClaudeCliRuntime } from './e2b-claude-cli-runtime.js';
import type { IdeSessionStore, StoredIdeSession } from '../ide/session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
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

describe('E2bClaudeCliRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs Claude CLI in the reusable E2B IDE sandbox workspace', async () => {
    const runCommand = vi.fn().mockImplementation(async (_session, _command, options) => {
      await options.onStdout('{"type":"system","session_id":"session-1","model":"claude-sonnet-4-6"}\n');
      await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      sessionId: 'session-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'system', session_id: 'session-1', model: 'claude-sonnet-4-6' },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' },
    ]);
    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining('claude'),
      expect.objectContaining({
        cwd: '/home/mycc/workspace',
        envs: expect.objectContaining({
          CLAUDE_CONFIG_DIR: '/home/mycc/.mycc/claude',
          HOME: '/home/mycc/.mycc/home',
        }),
      }),
    );
    expect(runCommand.mock.calls[0][1]).toContain('--resume');
    expect(runCommand.mock.calls[0][1]).toContain("'session-1'");
    expect(runCommand.mock.calls[0][1]).toContain("'hello'");
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
    const runCommand = vi.fn().mockImplementation(async (_session, _command, options) => {
      await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-2"}\n');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: store,
      e2bProvider: { startCodeServer, runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
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
      expect.stringContaining('claude'),
      expect.objectContaining({ cwd: '/home/mycc/workspace' }),
    );
  });

  it('maps CCR router env aliases into Claude CLI envs', async () => {
    vi.stubEnv('MYCC_CCR_BASE_URL', 'http://127.0.0.1:3456');
    vi.stubEnv('MYCC_CCR_AUTH_TOKEN', 'ccr-auth-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'stale-anthropic-api-key');
    const runCommand = vi.fn().mockImplementation(async (_session, _command, options) => {
      await options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"session-1"}\n');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(runCommand).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining('claude'),
      expect.objectContaining({
        envs: expect.objectContaining({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
          ANTHROPIC_AUTH_TOKEN: 'ccr-auth-token',
        }),
      }),
    );
    const cliEnv = runCommand.mock.calls[0][2].envs || {};
    expect(cliEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('marks a stale reusable E2B session stopped when CLI execution cannot find the sandbox', async () => {
    const store = createStore(runningSession);
    const runCommand = vi.fn().mockRejectedValue(new Error('sandbox not found'));
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: store,
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
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

  it('requires chat routes to pass userId for E2B sandbox lookup', async () => {
    const runCommand = vi.fn();
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: createStore(runningSession),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'E2B runtime requires userId' },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
