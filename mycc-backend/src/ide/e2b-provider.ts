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
  timeoutMs?: number;
  user?: string;
};

export class E2bSandboxProvider {
  constructor(private readonly sandboxFactory: E2bSandboxFactory = Sandbox) {}

  async startCodeServer(plan: E2bCodeServerSessionPlan): Promise<StartedCodeServerSession> {
    const apiKey = this.requireApiKey();

    const sandbox = await this.sandboxFactory.create(plan.template, {
      apiKey,
      timeoutMs: plan.sessionTtlSeconds * 1000,
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

    const command = await sandbox.commands.run(plan.startCommand, {
      background: true,
      cwd: plan.workspaceDir,
    });

    return {
      provider: 'e2b',
      sandboxId: sandbox.sandboxId,
      codeServerPid: command.pid,
      host: sandbox.getHost(plan.port),
      trafficAccessToken: sandbox.trafficAccessToken,
      port: plan.port,
      accessMode: plan.accessMode,
      expiresAt: new Date(Date.now() + plan.sessionTtlSeconds * 1000).toISOString(),
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
    const timeoutMs = sessionTtlSeconds * 1000;

    await sandbox.setTimeout?.(timeoutMs);

    return {
      ...session,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    };
  }

  async startDesktop(session: StartedCodeServerSession): Promise<StartedDesktopService> {
    const sandbox = await this.connect(session.sandboxId);
    const port = resolveDesktopPort();
    const command = await sandbox.commands.run('mycc-start-desktop', {
      background: true,
      cwd: '/home/mycc/workspace',
    });

    return {
      desktopPid: command.pid,
      desktopHost: sandbox.getHost(port),
      desktopPort: port,
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

  async isDesktopListening(session: StartedCodeServerSession): Promise<boolean> {
    const result = await this.runCommandInSession(
      session,
      'mycc-health-desktop >/dev/null',
      {
        cwd: '/home/mycc/workspace',
        timeoutMs: 5000,
      },
    );
    return result.exitCode === 0;
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
