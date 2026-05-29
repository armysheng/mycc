import { describe, expect, it, vi } from 'vitest';
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

  it('returns an error when no reusable E2B IDE session exists', async () => {
    const runCommand = vi.fn();
    const runtime = new E2bClaudeCliRuntime({
      sessionStore: createStore(null),
      e2bProvider: { runCommandInSession: runCommand },
    });

    const events = await collect(runtime.chat({
      userId: 42,
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: '请先打开 Remote IDE 以创建 E2B 沙箱会话' },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
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
