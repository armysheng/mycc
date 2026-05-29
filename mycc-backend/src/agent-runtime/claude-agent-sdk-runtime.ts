import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const SUPPORTED_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]);

export class ClaudeAgentSdkRuntime implements AgentRuntime {
  async *chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent> {
    if (params.images && params.images.length > 0) {
      yield { type: 'error', error: 'Agent SDK runtime 暂不支持图片消息' };
      return;
    }

    try {
      const stream = query({
        prompt: params.message,
        options: this.buildOptions(params),
      });

      for await (const message of stream) {
        yield this.toRuntimeEvent(message);
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildOptions(params: AgentChatParams): Options {
    const baseUrl = process.env.MYCC_AGENT_SDK_BASE_URL
      || process.env.ANTHROPIC_BASE_URL
      || process.env.VPS_ANTHROPIC_BASE_URL;
    const authToken = process.env.MYCC_AGENT_SDK_AUTH_TOKEN
      || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.VPS_ANTHROPIC_AUTH_TOKEN;
    const apiKey = process.env.MYCC_AGENT_SDK_API_KEY
      || process.env.ANTHROPIC_API_KEY;

    const env = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/agent-runtime',
      ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
      ...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    };

    const permissionMode = this.resolvePermissionMode();

    return {
      allowedTools: this.resolveAllowedTools(),
      cwd: params.cwd,
      env,
      includePartialMessages: process.env.MYCC_AGENT_SDK_PARTIAL_MESSAGES === 'true',
      model: process.env.MYCC_AGENT_SDK_MODEL
        || process.env.VPS_CLAUDE_MODEL
        || process.env.CLAUDE_MODEL
        || 'claude-sonnet-4-6',
      permissionMode,
      ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(params.sessionId ? { resume: params.sessionId } : {}),
      settingSources: [],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        excludeDynamicSections: true,
      },
    };
  }

  private resolveAllowedTools(): string[] {
    const raw = process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS;
    if (!raw) return DEFAULT_ALLOWED_TOOLS;
    return raw
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean);
  }

  private resolvePermissionMode(): PermissionMode {
    const raw = (process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'dontAsk').trim();
    if (SUPPORTED_PERMISSION_MODES.has(raw as PermissionMode)) {
      return raw as PermissionMode;
    }
    throw new Error(`Unsupported Agent SDK permission mode: ${raw}`);
  }

  private toRuntimeEvent(message: SDKMessage): AgentRuntimeEvent {
    return message as unknown as AgentRuntimeEvent;
  }
}
