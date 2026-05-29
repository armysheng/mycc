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
  };
  getHost(port: number): string;
};

type E2bSandboxFactory = {
  create(template: string, options: Record<string, unknown>): Promise<E2bSandboxLike>;
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
    const apiKey = process.env.MYCC_E2B_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('MYCC_E2B_API_KEY is required');
    }

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
}
