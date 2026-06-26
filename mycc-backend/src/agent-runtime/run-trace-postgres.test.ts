import { describe, expect, it, vi } from 'vitest';
import { PostgresAgentRunStore } from './run-trace-postgres.js';

describe('PostgresAgentRunStore', () => {
  it('inserts and maps agent runs', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            runtime_kind: 'claude-agent-sdk',
            status: 'running',
            started_at: '2026-06-05T10:00:00.000Z',
            ended_at: null,
            duration_ms: null,
            user_id: 42,
            request_id: 'req-1',
            chat_session_id: 'chat-1',
            sdk_session_id: null,
            cwd: '/home/tester/workspace',
            linux_user: 'tester',
            permission_mode: 'plan',
            message_preview: 'hello',
          },
        ],
      }),
    };
    const store = new PostgresAgentRunStore(db);

    const run = await store.createRun({
      id: '11111111-1111-1111-1111-111111111111',
      runtimeKind: 'claude-agent-sdk',
      userId: 42,
      requestId: 'req-1',
      chatSessionId: 'chat-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
      messagePreview: 'hello',
      startedAt: '2026-06-05T10:00:00.000Z',
    });

    expect(run).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      runtimeKind: 'claude-agent-sdk',
      status: 'running',
      startedAt: '2026-06-05T10:00:00.000Z',
      userId: 42,
      requestId: 'req-1',
      chatSessionId: 'chat-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
      messagePreview: 'hello',
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_runs'),
      expect.arrayContaining([
        '11111111-1111-1111-1111-111111111111',
        'claude-agent-sdk',
        'running',
      ]),
    );
  });

  it('stores event payloads as jsonb', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            run_id: '11111111-1111-1111-1111-111111111111',
            sequence: 1,
            timestamp: '2026-06-05T10:00:01.000Z',
            type: 'runtime.event',
            payload: { type: 'result', is_error: false },
          },
        ],
      }),
    };
    const store = new PostgresAgentRunStore(db);

    const event = await store.appendEvent({
      id: '22222222-2222-2222-2222-222222222222',
      runId: '11111111-1111-1111-1111-111111111111',
      type: 'runtime.event',
      payload: { type: 'result', is_error: false },
      timestamp: '2026-06-05T10:00:01.000Z',
    });

    expect(event).toEqual({
      id: '22222222-2222-2222-2222-222222222222',
      runId: '11111111-1111-1111-1111-111111111111',
      sequence: 1,
      timestamp: '2026-06-05T10:00:01.000Z',
      type: 'runtime.event',
      payload: { type: 'result', is_error: false },
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_run_events'),
      expect.arrayContaining([
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        null,
        '2026-06-05T10:00:01.000Z',
        'runtime.event',
        '{"type":"result","is_error":false}',
      ]),
    );
  });
});
