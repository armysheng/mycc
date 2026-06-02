import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { E2bSandboxProvider, type E2bCommandRunOptions } from '../ide/e2b-provider.js';
import { ensureE2bIdeSession } from '../ide/e2b-session.js';
import { isLikelyStaleE2bSessionError } from '../ide/e2b-session-errors.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';
import { parseAgentRunnerEventLine } from './agent-runner-events.js';
import { buildClaudeAgentRunnerRequest, parseCommaSeparatedList } from './agent-runner-request.js';
import { resolveClaudeProviderEnv } from './claude-env.js';
import { resolveSandboxTaskCwd, resolveSandboxWorkspaceRoot } from './e2b-workspace-paths.js';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';

type E2bClaudeAgentSdkProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>
  & Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;

export type E2bClaudeAgentSdkRuntimeOptions = {
  sessionStore?: IdeSessionStore;
  e2bProvider?: E2bClaudeAgentSdkProvider;
};

const DEFAULT_SANDBOX_LINUX_USER = 'mycc';
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep,Bash,Edit,Write';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const BRIDGE_PAYLOAD_CHUNK_SIZE = 16 * 1024;
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

      const userLinuxUser = sanitizeLinuxUsername(params.linuxUser);
      const sandboxUser = resolveSandboxLinuxUser();
      const workspaceRoot = resolveSandboxWorkspaceRoot(sandboxUser);
      const cwd = resolveSandboxTaskCwd({
        requestedCwd: params.cwd,
        requestedLinuxUser: userLinuxUser,
        sandboxWorkspaceRoot: workspaceRoot,
      });
      const session = await this.findOrCreateSession(params, workspaceRoot);

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
    const workspaceRoot = resolveSandboxWorkspaceRoot(sandboxUser);
    const permissionMode = resolvePermissionMode(params.permissionMode);
    try {
      await this.ensureSandboxTaskCwd(session, cwd, workspaceRoot);
    } catch (error) {
      await this.markSessionStoppedIfStale(session, error);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      return;
    }
    const envs = await this.prepareAgentSdkBridgeEnv(session, params, cwd, sandboxUser, permissionMode);

    let buffer = '';
    let stderrBuffer = '';
    const events: AgentRuntimeEvent[] = [];
    let pendingResumeEvents: AgentRuntimeEvent[] | null = params.sessionId
      ? []
      : null;
    let resumeMadeProgress = false;
    let finished = false;
    let resolveNext: (() => void) | null = null;

    const waitForEvent = () => new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    const pushEvent = (event: AgentRuntimeEvent) => {
      if (pendingResumeEvents && !resumeMadeProgress) {
        if (isResumeProgressEvent(event)) {
          resumeMadeProgress = true;
          events.push(...pendingResumeEvents, event);
          pendingResumeEvents = null;
        } else {
          pendingResumeEvents.push(event);
        }
        if (resolveNext && events.length > 0) {
          resolveNext();
          resolveNext = null;
        }
        return;
      }
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
        const event = parseAgentRunnerEventLine(line);
        if (event) pushEvent(event);
      }
    };

    const runPromise = this.e2bProvider.runCommandInSession(session, buildAgentSdkBridgeCommand(), {
      cwd,
      envs,
      onStdout: handleStdout,
      onStderr: (data) => {
        stderrBuffer += data;
      },
      signal: params.signal,
      timeoutMs: resolveCommandTimeoutMs(),
    } satisfies E2bCommandRunOptions).then(async (result) => {
      if (params.signal?.aborted) return;
      if (buffer.trim()) {
        const event = parseAgentRunnerEventLine(buffer);
        if (event) pushEvent(event);
      }
      if (result.exitCode !== 0) {
        const error = `Agent SDK bridge failed (exit code ${result.exitCode}): ${stderrBuffer.trim() || result.stderr || result.error || 'unknown error'}`;
        await this.markSessionStoppedIfStale(session, error);
        pushEvent({
          type: 'error',
          error,
        });
      }
    }).catch(async (error) => {
      if (params.signal?.aborted) return;
      await this.markSessionStoppedIfStale(session, error);
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
      if (params.signal?.aborted && events.length === 0) {
        break;
      }
      if (events.length > 0) {
        yield events.shift()!;
      } else {
        await waitForEvent();
      }
    }
    await runPromise;

    if (
      pendingResumeEvents &&
      isLikelyStaleResumeFailure(pendingResumeEvents)
    ) {
      yield* this.runAgentSdkBridge(
        session,
        { ...params, sessionId: undefined },
        cwd,
        sandboxUser,
      );
      return;
    }

    if (pendingResumeEvents) {
      for (const event of pendingResumeEvents) {
        yield event;
      }
    }
  }

  private async ensureSandboxTaskCwd(
    session: StoredIdeSession,
    cwd: string,
    workspaceRoot: string,
  ): Promise<void> {
    if (cwd === workspaceRoot) return;

    const result = await this.e2bProvider.runCommandInSession(
      session,
      `mkdir -p -- ${shellQuote(cwd)}`,
      {
        cwd: workspaceRoot,
        timeoutMs: 10_000,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Unable to prepare sandbox workspace directory (exit code ${result.exitCode}): ${result.stderr || result.error || 'unknown error'}`,
      );
    }
  }

  private async prepareAgentSdkBridgeEnv(
    session: StoredIdeSession,
    params: AgentChatParams,
    cwd: string,
    sandboxUser: string,
    permissionMode: string,
  ): Promise<Record<string, string>> {
    const payloadDir = `/tmp/mycc-agent-runtime/${Date.now()}-${randomUUID()}`;
    const requestFile = `${payloadDir}/request.json`;
    const request = buildClaudeAgentRunnerRequest(params, {
      allowedTools: parseCommaSeparatedList(resolveAllowedTools()),
      cwd,
      includePartialMessages: resolvePartialMessages(),
      model: resolveAgentSdkModel(),
      permissionMode,
    });
    await this.writeBridgePayloadFile(session, cwd, requestFile, JSON.stringify(request));

    return buildAgentSdkBridgeEnv(sandboxUser, requestFile);
  }

  private async writeBridgePayloadFile(
    session: StoredIdeSession,
    cwd: string,
    filePath: string,
    encodedPayload: string,
  ): Promise<void> {
    const parentDir = path.posix.dirname(filePath);
    const initResult = await this.e2bProvider.runCommandInSession(
      session,
      `mkdir -p -- ${shellQuote(parentDir)} && : > ${shellQuote(filePath)}`,
      {
        cwd,
        timeoutMs: 10_000,
      },
    );
    if (initResult.exitCode !== 0) {
      throw new Error(`Unable to prepare assistant message (exit code ${initResult.exitCode})`);
    }

    for (let offset = 0; offset < encodedPayload.length; offset += BRIDGE_PAYLOAD_CHUNK_SIZE) {
      const chunk = encodedPayload.slice(offset, offset + BRIDGE_PAYLOAD_CHUNK_SIZE);
      const appendResult = await this.e2bProvider.runCommandInSession(
        session,
        `printf %s ${shellQuote(chunk)} >> ${shellQuote(filePath)}`,
        {
          cwd,
          timeoutMs: 10_000,
        },
      );
      if (appendResult.exitCode !== 0) {
        throw new Error(`Unable to prepare assistant message (exit code ${appendResult.exitCode})`);
      }
    }
  }

  private async markSessionStoppedIfStale(session: StoredIdeSession, error: unknown): Promise<void> {
    if (!isLikelyStaleE2bSessionError(error)) return;
    await this.sessionStore.set({ ...session, status: 'stopped' });
  }
}

function isResumeProgressEvent(event: AgentRuntimeEvent): boolean {
  return event.type === 'system' || event.type === 'assistant' || event.type === 'user';
}

function isLikelyStaleResumeFailure(events: AgentRuntimeEvent[]): boolean {
  if (events.some(isResumeProgressEvent)) return false;
  return events.some((event) => {
    if (event.type === 'error') return true;
    return event.type === 'result' && event.is_error === true;
  });
}

function buildAgentSdkBridgeCommand(): string {
  const configured = process.env.MYCC_E2B_AGENT_SDK_BRIDGE_COMMAND?.trim();
  if (configured) {
    return configured;
  }
  return DEFAULT_BRIDGE_COMMAND;
}

function buildAgentSdkBridgeEnv(
  sandboxUser: string,
  requestFile: string,
): Record<string, string> {
  const home = `/home/${sandboxUser}/.mycc/home`;
  const claudeConfigDir = `/home/${sandboxUser}/.mycc/claude`;

  return {
    CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/e2b-agent-sdk-runtime',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    HOME: home,
    MYCC_AGENT_REQUEST_FILE: requestFile,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_DATA_HOME: `${home}/.local/share`,
    ...resolveClaudeProviderEnv(),
  };
}

function resolveAllowedTools(): string {
  return process.env.MYCC_E2B_AGENT_SDK_ALLOWED_TOOLS
    || process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS
    || DEFAULT_ALLOWED_TOOLS;
}

function resolvePartialMessages(): boolean {
  return process.env.MYCC_AGENT_SDK_PARTIAL_MESSAGES === 'true';
}

function resolvePermissionMode(requestedMode?: string): string {
  if (process.env.MYCC_E2B_AGENT_SDK_FORCE_BYPASS_PERMISSIONS !== 'false') {
    return 'bypassPermissions';
  }

  const raw = (requestedMode || process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'bypassPermissions').trim();
  if (SUPPORTED_PERMISSION_MODES.has(raw)) {
    return raw;
  }
  throw new Error(`Unsupported E2B Agent SDK permission mode: ${raw}`);
}

function resolveSandboxLinuxUser(): string {
  return sanitizeLinuxUsername(process.env.MYCC_E2B_LINUX_USER || DEFAULT_SANDBOX_LINUX_USER);
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
