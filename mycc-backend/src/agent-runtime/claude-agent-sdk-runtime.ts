import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const DEFAULT_USER_RUNTIME_DIR = '.mycc';
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
    const linuxUser = sanitizeLinuxUsername(params.linuxUser);
    const cwd = this.resolveWorkspaceCwd(params.cwd, linuxUser);
    const runtimeDirs = this.resolveRuntimeDirs(linuxUser);
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
      CLAUDE_CONFIG_DIR: runtimeDirs.claudeConfigDir,
      HOME: runtimeDirs.home,
      XDG_CONFIG_HOME: `${runtimeDirs.home}/.config`,
      XDG_DATA_HOME: `${runtimeDirs.home}/.local/share`,
      ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
      ...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    };

    const permissionMode = this.resolvePermissionMode();

    return {
      allowedTools: this.resolveAllowedTools(),
      cwd,
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

  private resolveWorkspaceCwd(cwd: string, linuxUser: string): string {
    const normalized = path.posix.normalize(cwd);
    const workspaceRoot = `/home/${linuxUser}/workspace`;
    if (normalized !== workspaceRoot && !normalized.startsWith(`${workspaceRoot}/`)) {
      throw new Error(`Invalid working directory: ${cwd}`);
    }
    return normalized;
  }

  private resolveRuntimeDirs(linuxUser: string): {
    claudeConfigDir: string;
    home: string;
  } {
    const configuredRoot = process.env.MYCC_AGENT_SDK_CONFIG_ROOT?.trim();
    if (configuredRoot) {
      const root = path.posix.normalize(configuredRoot);
      if (!root.startsWith('/')) {
        throw new Error('MYCC_AGENT_SDK_CONFIG_ROOT must be an absolute path');
      }
      return {
        claudeConfigDir: `${root}/${linuxUser}/.claude`,
        home: `${root}/${linuxUser}/home`,
      };
    }

    const userRuntimeRoot = `/home/${linuxUser}/${DEFAULT_USER_RUNTIME_DIR}`;
    return {
      claudeConfigDir: `${userRuntimeRoot}/claude`,
      home: `${userRuntimeRoot}/home`,
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
