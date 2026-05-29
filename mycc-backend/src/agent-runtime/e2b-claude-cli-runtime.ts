import path from 'node:path';
import { parseStreamLine } from '../adapters/stream-parser.js';
import { E2bSandboxProvider, type E2bCommandRunOptions } from '../ide/e2b-provider.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from '../ide/session-store.js';
import { escapeShellArg, sanitizeLinuxUsername } from '../utils/validation.js';
import type { AgentChatParams, AgentRuntime, AgentRuntimeEvent } from './types.js';

export type E2bClaudeCliRuntimeOptions = {
  sessionStore?: IdeSessionStore;
  e2bProvider?: Pick<E2bSandboxProvider, 'runCommandInSession'>;
};

const DEFAULT_SANDBOX_LINUX_USER = 'mycc';
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export class E2bClaudeCliRuntime implements AgentRuntime {
  private readonly sessionStore: IdeSessionStore;
  private readonly e2bProvider: Pick<E2bSandboxProvider, 'runCommandInSession'>;

  constructor(options: E2bClaudeCliRuntimeOptions = {}) {
    this.sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();
    this.e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  }

  async *chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent> {
    try {
      if (params.userId === undefined) {
        yield { type: 'error', error: 'E2B runtime requires userId' };
        return;
      }
      if (params.images && params.images.length > 0) {
        yield { type: 'error', error: 'E2B Claude CLI runtime 暂不支持图片消息' };
        return;
      }

      sanitizeLinuxUsername(params.linuxUser);
      const sandboxUser = resolveSandboxLinuxUser();
      const cwd = resolveSandboxWorkspaceCwd(sandboxUser);
      const session = await this.sessionStore.findReusableByUser(params.userId);
      if (!session) {
        yield { type: 'error', error: '请先打开 Remote IDE 以创建 E2B 沙箱会话' };
        return;
      }

      yield* this.runClaudeCommand(session, params, cwd, sandboxUser);
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async *runClaudeCommand(
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

    const runPromise = this.e2bProvider.runCommandInSession(session, buildClaudeCliCommand(params), {
      cwd,
      envs: buildClaudeEnv(sandboxUser),
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
          error: `Command failed (exit code ${result.exitCode}): ${stderrBuffer.trim() || result.stderr || result.error || 'unknown error'}`,
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

function buildClaudeCliCommand(params: AgentChatParams): string {
  const model = process.env.MYCC_E2B_CLAUDE_MODEL
    || process.env.VPS_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || 'claude-sonnet-4-6';
  const args = [
    'claude',
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--model',
    model,
    ...(params.sessionId ? ['--resume', params.sessionId] : []),
    params.message,
  ];
  return args.map(escapeShellArg).join(' ');
}

function buildClaudeEnv(sandboxUser: string): Record<string, string> {
  const home = `/home/${sandboxUser}/.mycc/home`;
  const claudeConfigDir = `/home/${sandboxUser}/.mycc/claude`;
  const baseUrl = process.env.MYCC_AGENT_SDK_BASE_URL
    || process.env.ANTHROPIC_BASE_URL
    || process.env.VPS_ANTHROPIC_BASE_URL;
  const authToken = process.env.MYCC_AGENT_SDK_AUTH_TOKEN
    || process.env.ANTHROPIC_AUTH_TOKEN
    || process.env.VPS_ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.MYCC_AGENT_SDK_API_KEY
    || process.env.ANTHROPIC_API_KEY;

  return {
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_DATA_HOME: `${home}/.local/share`,
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    ...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
  };
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

function resolveCommandTimeoutMs(): number {
  const raw = process.env.MYCC_E2B_CLAUDE_TIMEOUT_MS;
  if (!raw) return DEFAULT_COMMAND_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid MYCC_E2B_CLAUDE_TIMEOUT_MS: ${raw}`);
  }
  return parsed;
}
