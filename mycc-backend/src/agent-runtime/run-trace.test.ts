import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryAgentRunStore,
  redactTracePayload,
  TracedAgentRuntime,
  type AgentRunStore,
} from './run-trace.js';
import type { AgentRuntime, AgentRuntimeEvent } from './types.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function createRuntime(events: AgentRuntimeEvent[]): AgentRuntime {
  return {
    async *chat() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('agent run trace', () => {
  it('records a runtime timeline without changing streamed events', async () => {
    const store = new InMemoryAgentRunStore();
    const runtime = new TracedAgentRuntime(
      createRuntime([
        { type: 'system', subtype: 'init', session_id: 'sdk-session-1' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
        { type: 'result', subtype: 'success', is_error: false, session_id: 'sdk-session-1' },
      ]),
      'claude-agent-sdk',
      { runStore: store },
    );

    const events = await collect(runtime.chat({
      userId: 42,
      requestId: 'req-1',
      message: 'hello trace',
      sessionId: 'chat-session-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
    }));

    expect(events).toEqual([
      { type: 'system', subtype: 'init', session_id: 'sdk-session-1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'sdk-session-1' },
    ]);

    const runs = await store.listRuns({ userId: 42 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(expect.objectContaining({
      chatSessionId: 'chat-session-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      messagePreview: 'hello trace',
      permissionMode: 'plan',
      requestId: 'req-1',
      runtimeKind: 'claude-agent-sdk',
      sdkSessionId: 'sdk-session-1',
      status: 'succeeded',
      userId: 42,
    }));

    const runEvents = await store.listRunEvents(runs[0].id);
    expect(runEvents.map((event) => event.type)).toEqual([
      'run.started',
      'runtime.event',
      'runtime.event',
      'runtime.event',
      'run.finished',
    ]);
    expect(runEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('marks runs failed when the runtime yields an error event', async () => {
    const store = new InMemoryAgentRunStore();
    const runtime = new TracedAgentRuntime(
      createRuntime([
        { type: 'error', error: 'sdk boom', apiKey: 'secret-key' },
      ]),
      'e2b-claude-agent-sdk',
      { runStore: store },
    );

    await collect(runtime.chat({
      message: 'fail please',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    const runs = await store.listRuns();
    expect(runs[0].status).toBe('failed');
    const runEvents = await store.listRunEvents(runs[0].id);
    expect(runEvents[1].payload).toEqual({
      type: 'error',
      error: 'sdk boom',
      apiKey: '[REDACTED]',
    });
  });

  it('redacts secret-looking fields and truncates large strings', () => {
    const redacted = redactTracePayload({
      nested: {
        authorization: 'Bearer secret',
        trafficAccessToken: 'traffic-token',
        safe: 'x'.repeat(4_010),
      },
    });

    expect(redacted).toEqual({
      nested: {
        authorization: '[REDACTED]',
        trafficAccessToken: '[REDACTED]',
        safe: expect.stringContaining('[truncated 10 chars]'),
      },
    });
  });

  it('does not break the agent stream if the trace store fails', async () => {
    const store: AgentRunStore = {
      createRun: vi.fn().mockRejectedValue(new Error('store unavailable')),
      updateRun: vi.fn(),
      appendEvent: vi.fn(),
      getRun: vi.fn().mockResolvedValue(null),
      listRunEvents: vi.fn().mockResolvedValue([]),
      listRuns: vi.fn().mockResolvedValue([]),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = new TracedAgentRuntime(
      createRuntime([{ type: 'result', is_error: false }]),
      'remote-claude',
      { runStore: store },
    );

    try {
      await expect(collect(runtime.chat({
        message: 'hello',
        cwd: '/home/tester/workspace',
        linuxUser: 'tester',
      }))).resolves.toEqual([{ type: 'result', is_error: false }]);
    } finally {
      warn.mockRestore();
    }
  });
});
