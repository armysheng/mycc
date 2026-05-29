import { Sandbox } from 'e2b';
import type { E2bCodeServerSessionPlan, IdeAccessMode } from './service.js';

type CommandHandleLike = {
  pid: number;
};

type E2bSandboxLike = {
  sandboxId: string;
  trafficAccessToken?: string;
  commands: {
    run(command: string, options: { background: true; cwd: string }): Promise<CommandHandleLike>;
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

  private async connect(sandboxId: string): Promise<E2bSandboxLike> {
    const apiKey = this.requireApiKey();
    if (!this.sandboxFactory.connect) {
      throw new Error('E2B sandbox factory does not support connect');
    }
    return this.sandboxFactory.connect(sandboxId, { apiKey });
  }

  private requireApiKey(): string {
    const apiKey = process.env.MYCC_E2B_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('MYCC_E2B_API_KEY is required');
    }
    return apiKey;
  }
}
