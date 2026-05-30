import path from 'node:path';
import { parseStreamLine } from '../adapters/stream-parser.js';
import { E2bSandboxProvider, type E2bCommandRunOptions } from '../ide/e2b-provider.js';
import { ensureE2bIdeSession } from '../ide/e2b-session.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';
import { resolveClaudeProviderEnv } from './claude-env.js';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';

type E2bClaudeAgentSdkProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>
  & Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;

export type E2bClaudeAgentSdkRuntimeOptions = {
  sessionStore?: IdeSessionStore;
  e2bProvider?: E2bClaudeAgentSdkProvider;
};

const DEFAULT_SANDBOX_LINUX_USER = 'mycc';
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const SUPPORTED_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]);

const DEFAULT_BRIDGE_COMMAND = 'cd /opt/mycc-agent-runtime && node bridge.mjs';

export class E2bClaudeAgentSdkRuntime implements AgentRuntime {
  private readonly sessionStore: IdeSessionStore;
  private readonly e2bProvider: E2bClaudeAgentSdkProvider;

  constructor(options: E2bClaudeAgentSdkRuntimeOptions = {}) {
    this.sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();
    this.e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  }

  async *chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent> {
    try {
      if (params.userId === undefined) {
        yield { type: 'error', error: 'E2B Agent SDK runtime requires userId' };
        return;
      }
      if (params.images && params.images.length > 0) {
        yield { type: 'error', error: 'E2B Agent SDK runtime 暂不支持图片消息' };
        return;
      }

      sanitizeLinuxUsername(params.linuxUser);
      const sandboxUser = resolveSandboxLinuxUser();
      const cwd = resolveSandboxWorkspaceCwd(sandboxUser);
      const session = await this.findOrCreateSession(params, cwd);

      yield* this.runAgentSdkBridge(session, params, cwd, sandboxUser);
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async findOrCreateSession(params: AgentChatParams, workspaceDir: string): Promise<StoredIdeSession> {
    return ensureE2bIdeSession({
      userId: params.userId as number,
      linuxUser: params.linuxUser,
      workspaceDir,
      sessionStore: this.sessionStore,
      e2bProvider: this.e2bProvider,
      missingStartCodeServerMessage: 'E2B Agent SDK runtime provider cannot create IDE sessions',
    });
  }

  private async *runAgentSdkBridge(
    session: StoredIdeSession,
    params: AgentChatParams,
    cwd: string,
    sandboxUser: string,
  ): AsyncIterable<AgentRuntimeEvent> {
    let buffer = '';
    let stderrBuffer = '';
    const events: AgentRuntimeEvent[] = [];
    let finished = false;
    let resolveNext: (() => void) | null = null;

    const waitForEvent = () => new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    const pushEvent = (event: AgentRuntimeEvent) => {
      events.push(event);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };
    const handleStdout = (data: string) => {
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseStreamLine(line);
        if (event) pushEvent(event);
      }
    };

    const runPromise = this.e2bProvider.runCommandInSession(session, buildAgentSdkBridgeCommand(), {
      cwd,
      envs: buildAgentSdkBridgeEnv(params, cwd, sandboxUser),
      onStdout: handleStdout,
      onStderr: (data) => {
        stderrBuffer += data;
      },
      timeoutMs: resolveCommandTimeoutMs(),
    } satisfies E2bCommandRunOptions).then((result) => {
      if (buffer.trim()) {
        const event = parseStreamLine(buffer);
        if (event) pushEvent(event);
      }
      if (result.exitCode !== 0) {
        pushEvent({
          type: 'error',
          error: `Agent SDK bridge failed (exit code ${result.exitCode}): ${stderrBuffer.trim() || result.stderr || result.error || 'unknown error'}`,
        });
      }
    }).catch((error) => {
      pushEvent({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      finished = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    while (!finished || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!;
      } else {
        await waitForEvent();
      }
    }
    await runPromise;
  }
}

function buildAgentSdkBridgeCommand(): string {
  const configured = process.env.MYCC_E2B_AGENT_SDK_BRIDGE_COMMAND?.trim();
  if (configured) {
    return configured;
  }
  return DEFAULT_BRIDGE_COMMAND;
}

function buildAgentSdkBridgeEnv(
  params: AgentChatParams,
  cwd: string,
  sandboxUser: string,
): Record<string, string> {
  const home = `/home/${sandboxUser}/.mycc/home`;
  const claudeConfigDir = `/home/${sandboxUser}/.mycc/claude`;

  return {
    CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/e2b-agent-sdk-runtime',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    HOME: home,
    MYCC_AGENT_PROMPT_B64: Buffer.from(params.message, 'utf8').toString('base64'),
    MYCC_AGENT_SDK_ALLOWED_TOOLS: process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS,
    MYCC_AGENT_SDK_PARTIAL_MESSAGES: process.env.MYCC_AGENT_SDK_PARTIAL_MESSAGES || 'false',
    MYCC_AGENT_SDK_PERMISSION_MODE: resolvePermissionMode(),
    MYCC_AGENT_WORKSPACE_CWD: cwd,
    MYCC_E2B_AGENT_SDK_MODEL: resolveAgentSdkModel(),
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_DATA_HOME: `${home}/.local/share`,
    ...(params.sessionId ? { MYCC_AGENT_SESSION_ID: params.sessionId } : {}),
    ...resolveClaudeProviderEnv(),
  };
}

function resolvePermissionMode(): string {
  const raw = (process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'dontAsk').trim();
  if (SUPPORTED_PERMISSION_MODES.has(raw)) {
    return raw;
  }
  throw new Error(`Unsupported E2B Agent SDK permission mode: ${raw}`);
}

function resolveSandboxLinuxUser(): string {
  return sanitizeLinuxUsername(process.env.MYCC_E2B_LINUX_USER || DEFAULT_SANDBOX_LINUX_USER);
}

function resolveSandboxWorkspaceCwd(sandboxUser: string): string {
  const configured = process.env.MYCC_E2B_WORKSPACE_DIR?.trim();
  const cwd = path.posix.normalize(configured || `/home/${sandboxUser}/workspace`);
  const root = `/home/${sandboxUser}/workspace`;
  if (cwd !== root && !cwd.startsWith(`${root}/`)) {
    throw new Error(`Invalid E2B workspace directory: ${configured}`);
  }
  return cwd;
}

function resolveAgentSdkModel(): string {
  return process.env.MYCC_E2B_AGENT_SDK_MODEL
    || process.env.MYCC_AGENT_SDK_MODEL
    || process.env.VPS_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || DEFAULT_MODEL;
}

function resolveCommandTimeoutMs(): number {
  const raw = process.env.MYCC_E2B_AGENT_SDK_TIMEOUT_MS || process.env.MYCC_E2B_CLAUDE_TIMEOUT_MS;
  if (!raw) return DEFAULT_COMMAND_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid E2B Agent SDK timeout: ${raw}`);
  }
  return parsed;
}
