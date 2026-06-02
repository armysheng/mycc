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
        env: expect.objectContaining({
          CLAUDE_CONFIG_DIR: '/home/tester/.mycc/claude',
          HOME: '/home/tester/.mycc/home',
          XDG_CONFIG_HOME: '/home/tester/.mycc/home/.config',
          XDG_DATA_HOME: '/home/tester/.mycc/home/.local/share',
        }),
        includePartialMessages: false,
        model: 'claude-sonnet-4-6',
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
        resume: 'session-1',
        settingSources: [],
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
      }),
    });
  });

  it('sends image attachments as a multimodal Agent SDK user message', async () => {
    vi.mocked(query).mockReturnValue((async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' };
    })() as ReturnType<typeof query>);

    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
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
    const prompt = vi.mocked(query).mock.calls[0]![0]!.prompt;
    expect(typeof prompt).not.toBe('string');
    const messages = [];
    for await (const message of prompt as AsyncIterable<unknown>) {
      messages.push(message);
    }
    expect(messages).toEqual([
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '看一下截图' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw==',
              },
            },
          ],
        },
        parent_tool_use_id: null,
      },
    ]);
  });

  it('lets an explicit request permission mode override the backend default', async () => {
    vi.mocked(query).mockReturnValue((async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' };
    })() as ReturnType<typeof query>);

    const runtime = new ClaudeAgentSdkRuntime();
    await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
      permissionMode: 'plan',
    }));

    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        permissionMode: 'plan',
      }),
    });
    expect(vi.mocked(query).mock.calls[0]![0]!.options).not.toHaveProperty('allowDangerouslySkipPermissions');
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

  it('uses a configurable per-user runtime config root', async () => {
    vi.stubEnv('MYCC_AGENT_SDK_CONFIG_ROOT', '/srv/mycc/runtime');
    vi.mocked(query).mockReturnValue((async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' };
    })() as ReturnType<typeof query>);

    const runtime = new ClaudeAgentSdkRuntime();
    await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CONFIG_DIR: '/srv/mycc/runtime/tester/.claude',
          HOME: '/srv/mycc/runtime/tester/home',
        }),
      }),
    });
  });

  it('maps CCR router env aliases into Anthropic SDK env', async () => {
    vi.stubEnv('MYCC_CCR_BASE_URL', 'http://127.0.0.1:3456');
    vi.stubEnv('MYCC_CCR_AUTH_TOKEN', 'ccr-auth-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'stale-anthropic-api-key');
    vi.stubEnv('OPENAI_BASE_URL', 'https://openai-compatible.example.test/v1');
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.mocked(query).mockReturnValue((async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session-1' };
    })() as ReturnType<typeof query>);

    const runtime = new ClaudeAgentSdkRuntime();
    await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456',
          ANTHROPIC_AUTH_TOKEN: 'ccr-auth-token',
        }),
      }),
    });
    const sdkCall = vi.mocked(query).mock.calls[0]!;
    const sdkEnv = sdkCall[0]!.options!.env || {};
    expect(sdkEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(sdkEnv).not.toHaveProperty('OPENAI_BASE_URL');
    expect(sdkEnv).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('rejects relative runtime config roots', async () => {
    vi.stubEnv('MYCC_AGENT_SDK_CONFIG_ROOT', 'runtime/claude');

    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'MYCC_AGENT_SDK_CONFIG_ROOT must be an absolute path' },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects working directories outside the user workspace', async () => {
    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/other/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'Invalid working directory: /home/other/workspace' },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects working directories that escape through parent segments', async () => {
    const runtime = new ClaudeAgentSdkRuntime();
    const events = await collect(runtime.chat({
      message: 'hello',
      cwd: '/home/tester/workspace/../../other/workspace',
      linuxUser: 'tester',
    }));

    expect(events).toEqual([
      { type: 'error', error: 'Invalid working directory: /home/tester/workspace/../../other/workspace' },
    ]);
    expect(query).not.toHaveBeenCalled();
  });
});
