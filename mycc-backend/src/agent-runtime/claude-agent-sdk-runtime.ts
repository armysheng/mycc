import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, PermissionMode, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';
import { omitClaudeProviderEnv, resolveClaudeProviderEnv } from './claude-env.js';

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const DEFAULT_USER_RUNTIME_DIR = '.mycc';
const SUPPORTED_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
type SupportedImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];
type AgentSdkContentBlocks = Extract<SDKUserMessage['message']['content'], unknown[]>;
type AgentSdkContentBlock = AgentSdkContentBlocks[number];
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
    try {
      const stream = query({
        prompt: buildAgentSdkPrompt(params),
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

    const env = {
      ...omitClaudeProviderEnv(),
      CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/agent-runtime',
      CLAUDE_CONFIG_DIR: runtimeDirs.claudeConfigDir,
      HOME: runtimeDirs.home,
      XDG_CONFIG_HOME: `${runtimeDirs.home}/.config`,
      XDG_DATA_HOME: `${runtimeDirs.home}/.local/share`,
      ...resolveClaudeProviderEnv(),
    };

    const permissionMode = this.resolvePermissionMode(params.permissionMode);

    return {
      allowedTools: this.resolveAllowedTools(),
      ...(params.abortController ? { abortController: params.abortController } : {}),
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

  private resolvePermissionMode(requestedMode: AgentChatParams['permissionMode']): PermissionMode {
    const raw = (requestedMode || process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'bypassPermissions').trim();
    if (SUPPORTED_PERMISSION_MODES.has(raw as PermissionMode)) {
      return raw as PermissionMode;
    }
    throw new Error(`Unsupported Agent SDK permission mode: ${raw}`);
  }

  private toRuntimeEvent(message: SDKMessage): AgentRuntimeEvent {
    return message as unknown as AgentRuntimeEvent;
  }
}

function buildAgentSdkPrompt(params: AgentChatParams): string | AsyncIterable<SDKUserMessage> {
  if (!params.images || params.images.length === 0) {
    return params.message;
  }

  async function* promptStream(): AsyncIterable<SDKUserMessage> {
    const imageBlocks: AgentSdkContentBlock[] = params.images!.map((image): AgentSdkContentBlock => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: requireSupportedImageMediaType(image.mediaType),
        data: image.data,
      },
    }));

    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: params.message },
          ...imageBlocks,
        ],
      },
      parent_tool_use_id: null,
    };
  }

  return promptStream();
}

function requireSupportedImageMediaType(mediaType: string): SupportedImageMediaType {
  if (
    SUPPORTED_IMAGE_MEDIA_TYPES.includes(
      mediaType as SupportedImageMediaType,
    )
  ) {
    return mediaType as SupportedImageMediaType;
  }
  throw new Error(`Unsupported image media type: ${mediaType}`);
}
