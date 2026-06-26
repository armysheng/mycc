import { RemoteSkillStore } from './remote-skill-store.js';
import { SkillsService } from './skills-service.js';
import type { ISkillsService } from './contracts.js';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { ensureE2bIdeSession, type E2bIdeSessionProvider } from '../ide/e2b-session.js';
import { buildE2bCodeServerSessionPlan } from '../ide/service.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
} from '../ide/session-store.js';
import type {
  SkillCommandRunner,
  SkillCommandRunnerFactory,
  SkillRuntimeContext,
} from './remote-skill-store.js';

type E2bSkillRunnerProvider = E2bIdeSessionProvider
  & Pick<E2bSandboxProvider, 'runCommandInSession'>;

export type CreateSkillsServiceOptions = {
  env?: NodeJS.ProcessEnv;
  e2bProvider?: E2bSkillRunnerProvider;
  ideSessionStore?: IdeSessionStore;
};

export function createSkillsService(options: CreateSkillsServiceOptions = {}): ISkillsService {
  const env = options.env ?? process.env;
  const useE2bSkillRunner = shouldUseE2bSkillRunner(env);
  const runnerFactory = useE2bSkillRunner
    ? createE2bSkillCommandRunnerFactory(options, env)
    : undefined;
  return new SkillsService(new RemoteSkillStore(runnerFactory), {
    ...(useE2bSkillRunner
      ? {
          resolveInstallLinuxUser: (context) => buildE2bCodeServerSessionPlan({
            userId: context.userId,
            linuxUser: context.linuxUser,
            workspaceDir: `/home/${context.linuxUser}/workspace`,
          }, env).linuxUser,
        }
      : {}),
  });
}

export * from './types.js';
export * from './contracts.js';
export * from './errors.js';
export * from './skill-registry.js';

function shouldUseE2bSkillRunner(env: NodeJS.ProcessEnv): boolean {
  return (
    env.MYCC_IDE_PROVIDER === 'e2b' ||
    env.MYCC_WORKSPACE_PROVIDER === 'e2b' ||
    env.MYCC_AGENT_RUNTIME === 'e2b-claude-agent-sdk'
  );
}

function createE2bSkillCommandRunnerFactory(
  options: CreateSkillsServiceOptions,
  env: NodeJS.ProcessEnv
): SkillCommandRunnerFactory {
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const sessionStore = options.ideSessionStore ?? new PostgresIdeSessionStore();

  return async (context: SkillRuntimeContext): Promise<SkillCommandRunner> => {
    if (!context.userId) {
      throw new Error('E2B skill runner requires userId');
    }
    if (!e2bProvider.runCommandInSession) {
      throw new Error('E2B provider cannot run skill commands');
    }

    const plan = buildE2bCodeServerSessionPlan({
      userId: context.userId,
      linuxUser: context.linuxUser,
      workspaceDir: `/home/${context.linuxUser}/workspace`,
    }, env);
    const session = await ensureE2bIdeSession({
      userId: context.userId,
      linuxUser: context.linuxUser,
      workspaceDir: plan.workspaceDir,
      sessionStore,
      e2bProvider,
      env,
      missingStartCodeServerMessage: 'E2B provider cannot create skill runtime sessions',
    });
    const run = (command: string) => e2bProvider.runCommandInSession!(session, command, {
      cwd: plan.workspaceDir,
      timeoutMs: 30_000,
      user: plan.linuxUser,
    });

    return {
      linuxUser: plan.linuxUser,
      run,
      runAsUser: run,
      autoSeedOnList: false,
    };
  };
}
