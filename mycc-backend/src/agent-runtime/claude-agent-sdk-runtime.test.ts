import { query } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAgentSdkRuntime } from './claude-agent-sdk-runtime.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('ClaudeAgentSdkRuntime', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes isolated and safe defaults to the Agent SDK', async () => {
    vi.stubEnv('MYCC_AGENT_SDK_ALLOWED_TOOLS', 'Read,Glob,Grep');
    vi.stubEnv('MYCC_AGENT_SDK_MODEL', 'claude-sonnet-4-6');

    vi.mocked(query).mockReturnValue((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'session-1' };
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' };
    })() as ReturnType<typeof query>);

    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
      message: 'hello',
      sessionId: 'session-1',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'system', subtype: 'init', session_id: 'session-1' },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' },
    ]);
    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        allowedTools: ['Read', 'Glob', 'Grep'],
        cwd: '/home/tester/workspace',
        includePartialMessages: false,
        model: 'claude-sonnet-4-6',
        permissionMode: 'dontAsk',
        resume: 'session-1',
        settingSources: [],
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
      }),
    });
  });

  it('maps SDK failures into runtime error events', async () => {
    vi.mocked(query).mockImplementation(() => {
      throw new Error('sdk boom');
    });

    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'sdk boom' },
    ]);
  });
});
