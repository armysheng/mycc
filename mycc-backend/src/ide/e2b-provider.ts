import { Sandbox } from 'e2b';
import { requireE2bApiKey } from './e2b-api-key.js';
import { DEFAULT_DESKTOP_NOVNC_PORT, type E2bCodeServerSessionPlan, type IdeAccessMode } from './service.js';

type CommandHandleLike = {
  pid: number;
};

type CommandResultLike = {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
};

type E2bSandboxLike = {
  sandboxId: string;
  trafficAccessToken?: string;
  commands: {
    run(command: string, options: E2bCommandRunOptions & { background: true }): Promise<CommandHandleLike>;
    run(command: string, options?: E2bCommandRunOptions & { background?: false }): Promise<CommandResultLike>;
    kill?(pid: number): Promise<boolean>;
  };
  getHost(port: number): string;
  setTimeout?(timeoutMs: number): Promise<void>;
  kill?(): Promise<void>;
};

type E2bSandboxFactory = {
  create(template: string, options: Record<string, unknown>): Promise<E2bSandboxLike>;
  connect?(sandboxId: string, options: Record<string, unknown>): Promise<E2bSandboxLike>;
};

const DESKTOP_WORKDIR = '/home/mycc/workspace';
const DESKTOP_HEALTH_TIMEOUT_MS = 5000;
const DESKTOP_READY_TIMEOUT_MS = 60_000;
const DESKTOP_READY_POLL_MS = 1_000;
const CODE_SERVER_HEALTH_TIMEOUT_MS = 5000;
const DEFAULT_CODE_SERVER_READY_TIMEOUT_MS = 120_000;
const CODE_SERVER_READY_POLL_MS = 1_000;
const CODE_SERVER_LAUNCH_TIMEOUT_MS = 10_000;
const DEFAULT_DESKTOP_VNC_PORT = 15900;
const DEFAULT_DESKTOP_RESOLUTION = '1440x900';
const DEFAULT_DESKTOP_MODE = 'browser-only';
const DEFAULT_CREATE_RETRY_ATTEMPTS = 3;
const DEFAULT_CREATE_RETRY_DELAY_MS = 1_000;
const E2B_MAX_TIMEOUT_MS = 60 * 60 * 1000;

export type StartedCodeServerSession = {
  provider: 'e2b';
  sandboxId: string;
  codeServerPid: number;
  host: string;
  trafficAccessToken?: string;
  port: number;
  accessMode: IdeAccessMode;
  expiresAt: string;
};

export type StartedDesktopService = {
  desktopPid: number;
  desktopHost: string;
  desktopPort: number;
};

export type E2bCommandRunOptions = {
  background?: boolean;
  cwd?: string;
  envs?: Record<string, string>;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  user?: string;
};

export class E2bSandboxProvider {
  constructor(private readonly sandboxFactory: E2bSandboxFactory = Sandbox) {}

  async startCodeServer(plan: E2bCodeServerSessionPlan): Promise<StartedCodeServerSession> {
    const apiKey = this.requireApiKey();
    const timeoutMs = resolveE2bTimeoutMs(plan.sessionTtlSeconds);

    const sandbox = await this.createSandboxWithRetry(plan, apiKey, timeoutMs);

    const codeServerPid = await this.startDurableCodeServerProcess(sandbox, plan);

    try {
      await this.waitForCodeServerHealthy(sandbox, plan);
    } catch (error) {
      if (sandbox.commands.kill) {
        await sandbox.commands.kill(codeServerPid).catch(() => false);
      }
      if (sandbox.kill) {
        await sandbox.kill().catch(() => undefined);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`code-server did not become ready: ${detail}`);
    }

    if (plan.desktopEnabled) {
      await this.prewarmDesktop(sandbox);
    }

    return {
      provider: 'e2b',
      sandboxId: sandbox.sandboxId,
      codeServerPid,
      host: sandbox.getHost(plan.port),
      trafficAccessToken: sandbox.trafficAccessToken,
      port: plan.port,
      accessMode: plan.accessMode,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    };
  }

  async stopCodeServer(session: StartedCodeServerSession): Promise<void> {
    const sandbox = await this.connect(session.sandboxId);

    await sandbox.commands.kill?.(session.codeServerPid);
    await sandbox.kill?.();
  }

  async renewCodeServer(
    session: StartedCodeServerSession,
    sessionTtlSeconds: number,
  ): Promise<StartedCodeServerSession> {
    const sandbox = await this.connect(session.sandboxId);
    const timeoutMs = resolveE2bTimeoutMs(sessionTtlSeconds);

    await sandbox.setTimeout?.(timeoutMs);

    return {
      ...session,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    };
  }

  async startDesktop(session: StartedCodeServerSession): Promise<StartedDesktopService> {
    const sandbox = await this.connect(session.sandboxId);
    const templatePort = resolveDesktopPort();
    const existingDesktopHealthy = await this.isDesktopHealthy(sandbox, templatePort);
    let desktopPid: number;
    if (existingDesktopHealthy) {
      desktopPid = await this.findDesktopPid(sandbox, templatePort) ?? session.codeServerPid;
    } else {
      const inFlightDesktopPid = await this.findDesktopPid(sandbox, templatePort);
      if (inFlightDesktopPid && await this.waitForDesktopHealthy(sandbox, templatePort)) {
        return {
          desktopPid: inFlightDesktopPid,
          desktopHost: sandbox.getHost(templatePort),
          desktopPort: templatePort,
        };
      }

      const command = await sandbox.commands.run('mycc-start-desktop', {
        background: true,
        cwd: DESKTOP_WORKDIR,
        envs: buildDesktopEnv(templatePort),
      });
      desktopPid = command.pid;
      if (!await this.waitForDesktopHealthy(sandbox, templatePort)) {
        throw new Error('Desktop service did not become ready');
      }
    }

    return {
      desktopPid,
      desktopHost: sandbox.getHost(templatePort),
      desktopPort: templatePort,
    };
  }

  async runCommandInSession(
    session: StartedCodeServerSession,
    command: string,
    options: E2bCommandRunOptions = {},
  ): Promise<CommandResultLike> {
    const sandbox = await this.connect(session.sandboxId);
    return sandbox.commands.run(command, {
      ...options,
      background: false,
    });
  }

  async isCodeServerListening(session: StartedCodeServerSession): Promise<boolean> {
    const result = await this.runCommandInSession(
      session,
      `node -e "fetch('http://127.0.0.1:${session.port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
      {
        cwd: '/home/mycc/workspace',
        timeoutMs: 5000,
      },
    );
    return result.exitCode === 0;
  }

  private async waitForCodeServerHealthy(
    sandbox: E2bSandboxLike,
    plan: E2bCodeServerSessionPlan,
  ): Promise<void> {
    const timeoutMs = resolveCodeServerReadyTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    let lastError = 'not checked';

    do {
      try {
        const result = await sandbox.commands.run(buildCodeServerHealthCommand(plan.port), {
          background: false,
          cwd: plan.workspaceDir,
          timeoutMs: CODE_SERVER_HEALTH_TIMEOUT_MS,
        });
        if (result.exitCode === 0) {
          return;
        }
        lastError = result.stderr || result.error || result.stdout || `exit=${result.exitCode}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (Date.now() >= deadline) break;
      await sleep(CODE_SERVER_READY_POLL_MS);
    } while (Date.now() < deadline);

    throw new Error(lastError);
  }

  private async startDurableCodeServerProcess(
    sandbox: E2bSandboxLike,
    plan: E2bCodeServerSessionPlan,
  ): Promise<number> {
    const result = await sandbox.commands.run(buildDurableCodeServerStartCommand(plan), {
      background: false,
      cwd: plan.workspaceDir,
      timeoutMs: CODE_SERVER_LAUNCH_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.error || 'code-server launcher failed');
    }
    const pid = Number.parseInt(result.stdout.trim().split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`code-server launcher did not return a pid: ${result.stdout.trim()}`);
    }
    return pid;
  }

  async isDesktopListening(session: StartedCodeServerSession & { desktopPort?: number }): Promise<boolean> {
    const port = session.desktopPort ?? resolveDesktopPort();
    const result = await this.runCommandInSession(
      session,
      buildDesktopHealthCommand(port),
      {
        cwd: DESKTOP_WORKDIR,
        timeoutMs: 5000,
      },
    );
    return result.exitCode === 0;
  }

  private async waitForDesktopHealthy(sandbox: E2bSandboxLike, port: number): Promise<boolean> {
    const deadline = Date.now() + DESKTOP_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isDesktopHealthy(sandbox, port)) {
        return true;
      }
      await sleep(DESKTOP_READY_POLL_MS);
    }
    return false;
  }

  private async isDesktopHealthy(sandbox: E2bSandboxLike, port: number): Promise<boolean> {
    try {
      const result = await sandbox.commands.run(buildDesktopHealthCommand(port), {
        background: false,
        cwd: DESKTOP_WORKDIR,
        timeoutMs: DESKTOP_HEALTH_TIMEOUT_MS,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async prewarmDesktop(sandbox: E2bSandboxLike): Promise<void> {
    try {
      await sandbox.commands.run('mycc-start-desktop', {
        background: true,
        cwd: DESKTOP_WORKDIR,
        envs: buildDesktopEnv(resolveDesktopPort()),
      });
    } catch {
      // Desktop prewarm is a latency optimization. Code-server remains the primary session path.
    }
  }

  private async findDesktopPid(sandbox: E2bSandboxLike, port: number): Promise<number | null> {
    const result = await sandbox.commands.run(buildFindDesktopPidCommand(port), {
      background: false,
      cwd: DESKTOP_WORKDIR,
      timeoutMs: DESKTOP_HEALTH_TIMEOUT_MS,
    });
    const pid = Number.parseInt(result.stdout.trim().split(/\s+/)[0] ?? '', 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  private async connect(sandboxId: string): Promise<E2bSandboxLike> {
    const apiKey = this.requireApiKey();
    if (!this.sandboxFactory.connect) {
      throw new Error('E2B sandbox factory does not support connect');
    }
    return this.sandboxFactory.connect(sandboxId, { apiKey });
  }

  private requireApiKey(): string {
    return requireE2bApiKey();
  }

  private async createSandboxWithRetry(
    plan: E2bCodeServerSessionPlan,
    apiKey: string,
    timeoutMs: number,
  ): Promise<E2bSandboxLike> {
    const attempts = resolveCreateRetryAttempts();
    const retryDelayMs = resolveCreateRetryDelayMs();
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.sandboxFactory.create(plan.template, {
          apiKey,
          timeoutMs,
          metadata: {
            app: 'mycc',
            capability: 'code-server',
            linuxUser: plan.linuxUser,
            userId: String(plan.userId),
          },
          network: {
            allowPublicTraffic: false,
          },
        });
      } catch (err) {
        lastError = err;
        if (attempt >= attempts || !isTransientSandboxPlacementError(err)) {
          throw err;
        }
        await sleep(retryDelayMs * attempt);
      }
    }

    throw lastError;
  }
}

function resolveE2bTimeoutMs(sessionTtlSeconds: number): number {
  return Math.min(sessionTtlSeconds * 1000, E2B_MAX_TIMEOUT_MS);
}

function isTransientSandboxPlacementError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Failed to place sandbox/i.test(message);
}

function resolveCreateRetryAttempts(): number {
  const raw = process.env.MYCC_E2B_CREATE_RETRY_ATTEMPTS;
  if (!raw) return DEFAULT_CREATE_RETRY_ATTEMPTS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error(`Invalid MYCC_E2B_CREATE_RETRY_ATTEMPTS: ${raw}`);
  }
  return parsed;
}

function resolveCreateRetryDelayMs(): number {
  const raw = process.env.MYCC_E2B_CREATE_RETRY_DELAY_MS;
  if (!raw) return DEFAULT_CREATE_RETRY_DELAY_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30_000) {
    throw new Error(`Invalid MYCC_E2B_CREATE_RETRY_DELAY_MS: ${raw}`);
  }
  return parsed;
}

function resolveCodeServerReadyTimeoutMs(): number {
  const raw = process.env.MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS;
  if (!raw) return DEFAULT_CODE_SERVER_READY_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10 * 60 * 1000) {
    throw new Error(`Invalid MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS: ${raw}`);
  }
  return parsed;
}

function buildCodeServerHealthCommand(port: number): string {
  return `node -e "fetch('http://127.0.0.1:${port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
}

function buildDurableCodeServerStartCommand(plan: E2bCodeServerSessionPlan): string {
  const stdout = `/tmp/mycc-code-server-${plan.port}.stdout.log`;
  const stderr = `/tmp/mycc-code-server-${plan.port}.stderr.log`;
  return [
    'mkdir -p /tmp;',
    `nohup sh -lc ${shellQuote(plan.startCommand)} > ${shellQuote(stdout)} 2> ${shellQuote(stderr)} < /dev/null &`,
    'echo $!',
  ].join(' ');
}

function resolveDesktopPort(): number {
  const raw = process.env.MYCC_E2B_DESKTOP_PORT;
  if (!raw) return DEFAULT_DESKTOP_NOVNC_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`Invalid MYCC_E2B_DESKTOP_PORT: ${raw}`);
  }
  return parsed;
}

function resolveDesktopVncPort(): number {
  const raw = process.env.MYCC_E2B_DESKTOP_VNC_PORT;
  if (!raw) return DEFAULT_DESKTOP_VNC_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`Invalid MYCC_E2B_DESKTOP_VNC_PORT: ${raw}`);
  }
  return parsed;
}

function resolveDesktopResolution(): string {
  const raw = process.env.MYCC_E2B_DESKTOP_RESOLUTION || DEFAULT_DESKTOP_RESOLUTION;
  if (!/^\d{3,5}x\d{3,5}$/.test(raw)) {
    throw new Error(`Invalid MYCC_E2B_DESKTOP_RESOLUTION: ${raw}`);
  }
  return raw;
}

function resolveDesktopMode(): string {
  const raw = process.env.MYCC_E2B_DESKTOP_MODE || DEFAULT_DESKTOP_MODE;
  if (!/^(browser-only|browser|xfce|desktop)$/.test(raw)) {
    throw new Error(`Invalid MYCC_E2B_DESKTOP_MODE: ${raw}`);
  }
  return raw;
}

function buildDesktopEnv(port: number): Record<string, string> {
  const resolution = resolveDesktopResolution();
  return {
    MYCC_DESKTOP_MODE: resolveDesktopMode(),
    MYCC_DESKTOP_NOVNC_PORT: String(port),
    MYCC_DESKTOP_OPEN_BROWSER: '1',
    MYCC_DESKTOP_RESOLUTION: resolution,
    MYCC_DESKTOP_BROWSER_WINDOW_SIZE: resolution.replace('x', ','),
  };
}

function buildDesktopHealthCommand(port: number): string {
  return `MYCC_DESKTOP_NOVNC_PORT=${port} mycc-health-desktop >/dev/null`;
}

function buildFindDesktopPidCommand(port: number): string {
    const vncPort = resolveDesktopVncPort();
    return [
    `pgrep -f "mycc-start-desktop"`,
    `pgrep -f "websockify.*0\\.0\\.0\\.0:${port}"`,
    `pgrep -f "websockify.*:${port}"`,
    `pgrep -f "x11vnc.*-rfbport ${vncPort}"`,
    'true',
  ].join('; ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
