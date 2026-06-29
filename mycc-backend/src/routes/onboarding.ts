import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById, markUserInitialized } from '../db/client.js';
import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername, escapeShellArg } from '../utils/validation.js';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { ensureE2bIdeSession } from '../ide/e2b-session.js';
import { buildE2bCodeServerSessionPlan } from '../ide/service.js';
import { PostgresIdeSessionStore, type IdeSessionStore } from '../ide/session-store.js';
import {
  buildClaudeHomeTemplateSeedCommand,
  buildWorkspaceTemplateSeedCommand,
  listUserClaudeHomeTemplateFiles,
  listUserWorkspaceTemplateFiles,
} from '../workspace/user-workspace-template.js';

const MYCC_GROUP = 'mycc';
const REMOTE_TEMPLATE_DIR = '/opt/mycc/templates/user-workspace';
const E2B_ONBOARDING_SEED_TIMEOUT_MS = 30_000;

const initializeSchema = z.object({
  assistantName: z.preprocess(
    (val) => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '助手名称不能为空').max(20, '助手名称最长 20 字符')
  ),
  ownerName: z.preprocess(
    (val) => typeof val === 'string' ? val.trim() : val,
    z.string().min(1, '称呼不能为空').max(20, '称呼最长 20 字符')
  ),
});

type InitializeSuccessResponse = {
  success: true;
  data: {
    status: 'ready' | 'running' | 'idle' | 'failed';
    jobId?: string;
    error?: string;
  };
};
type OnboardingE2bProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>
  & Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;
type OnboardingUser = NonNullable<Awaited<ReturnType<typeof findUserById>>>;
type OnboardingJobStatus = 'running' | 'ready' | 'failed';
type OnboardingJob = {
  jobId: string;
  userId: number;
  status: OnboardingJobStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type OnboardingRoutesOptions = {
  env?: NodeJS.ProcessEnv;
  e2bProvider?: OnboardingE2bProvider;
  ideSessionStore?: IdeSessionStore;
  templateRoot?: string;
};

const onboardingJobs = new Map<number, OnboardingJob>();

function publicOnboardingFailureResponse() {
  return {
    success: false as const,
    error: '初始化暂时没完成，请稍后重试',
    code: 'initialization_unavailable',
  };
}

function classifyOnboardingFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Failed to place sandbox/i.test(message)) {
    return 'placement_unavailable';
  }
  if (/seed|写入|workspace/i.test(message)) {
    return 'workspace_seed_failed';
  }
  return 'provider_unavailable';
}

export function shouldPrepareOnboardingWorkspaceWithSsh(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MYCC_WORKSPACE_PROVIDER || 'ssh').trim() !== 'e2b';
}

export function shouldRunOnboardingAsync(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MYCC_ONBOARDING_ASYNC || '').trim().toLowerCase() === 'true';
}

function resolveTemplateRoot(env: NodeJS.ProcessEnv, explicitRoot?: string): string {
  if (explicitRoot) return explicitRoot;
  if (env.MYCC_USER_WORKSPACE_TEMPLATE_DIR) return env.MYCC_USER_WORKSPACE_TEMPLATE_DIR;
  if (fs.existsSync(REMOTE_TEMPLATE_DIR)) return REMOTE_TEMPLATE_DIR;
  return path.resolve(process.cwd(), 'templates/user-workspace');
}

function buildWorkspaceLegacyIdentityCleanupCommand(workspaceDir: string): string {
  const marker = 'MYCC_WORKSPACE_LEGACY_IDENTITY_CLEANUP';
  const script = [
    'const fs=require("fs");',
    'const path=require("path");',
    `const workspaceDir=${JSON.stringify(workspaceDir)};`,
    'const root=path.resolve(workspaceDir);',
    'const inside=(target)=>target===root||target.startsWith(root+path.sep);',
    'const removeTargets=["0-System/about-me","0-System/memory","0-System/context.md","0-System/status.md"];',
    'for(const rel of removeTargets){',
    '  const target=path.resolve(root,rel);',
    '  if(!inside(target)) throw new Error(`path-outside-workspace:${rel}`);',
    '  fs.rmSync(target,{recursive:true,force:true});',
    '}',
    'process.stdout.write("cleaned");',
  ].join('\n');

  return `node <<'${marker}'\n${script}\n${marker}`;
}

async function prepareOnboardingWorkspaceWithSsh(params: {
  env: NodeJS.ProcessEnv;
  templateRoot?: string;
  sshLinuxUser: string;
  workspaceDir: string;
  assistantName: string;
  ownerName: string;
  userId: number;
}) {
  const homeDir = `/home/${params.sshLinuxUser}`;
  const claudeHomeDir = `${homeDir}/.claude`;
  const templateRoot = resolveTemplateRoot(params.env, params.templateRoot);
  const claudeHomeFiles = listUserClaudeHomeTemplateFiles({
    templateRoot,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    includeBootstrapSentinel: false,
    overwrite: () => true,
  });
  const workspaceFiles = listUserWorkspaceTemplateFiles({
    templateRoot,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    includeBootstrapSentinel: false,
    overwrite: (relativePath) => relativePath === 'CLAUDE.md',
  });

  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();

  try {
    const prepareUserCmd = [
      `getent group ${MYCC_GROUP} >/dev/null 2>&1 || sudo groupadd ${MYCC_GROUP}`,
      `(id ${escapeShellArg(params.sshLinuxUser)} >/dev/null 2>&1 || sudo useradd -m -g ${MYCC_GROUP} -s /bin/bash ${escapeShellArg(params.sshLinuxUser)} || true)`,
      `id ${escapeShellArg(params.sshLinuxUser)} >/dev/null 2>&1`,
      `sudo mkdir -p ${escapeShellArg(claudeHomeDir)} ${escapeShellArg(params.workspaceDir)}`,
      `sudo chown -R ${escapeShellArg(params.sshLinuxUser)}:${MYCC_GROUP} ${escapeShellArg(homeDir)}`,
    ].join(' && ');

    const preparedUser = await sshPool.exec(connection, prepareUserCmd);
    if (preparedUser.exitCode !== 0) {
      console.error(`❌ Onboarding 用户目录准备失败 userId=${params.userId}: ${preparedUser.stderr}`);
      throw new Error('初始化目录准备失败，请稍后重试');
    }

    const claudeHomeResult = await sshPool.exec(
      connection,
      `sudo -n -u ${escapeShellArg(params.sshLinuxUser)} bash -lc ${escapeShellArg(buildClaudeHomeTemplateSeedCommand({
        claudeHomeDir,
        files: claudeHomeFiles,
      }))}`,
    );
    if (claudeHomeResult.exitCode !== 0) {
      throw new Error(claudeHomeResult.stderr || '初始化 Claude home 写入失败');
    }

    const workspaceResult = await sshPool.exec(
      connection,
      `sudo -n -u ${escapeShellArg(params.sshLinuxUser)} bash -lc ${escapeShellArg(buildWorkspaceTemplateSeedCommand({
        workspaceDir: params.workspaceDir,
        files: workspaceFiles,
      }))}`,
    );
    if (workspaceResult.exitCode !== 0) {
      throw new Error(workspaceResult.stderr || '初始化工作区入口写入失败');
    }

    const cleanupResult = await sshPool.exec(
      connection,
      `sudo -n -u ${escapeShellArg(params.sshLinuxUser)} bash -lc ${escapeShellArg(buildWorkspaceLegacyIdentityCleanupCommand(params.workspaceDir))}`,
    );
    if (cleanupResult.exitCode !== 0) {
      throw new Error(cleanupResult.stderr || '初始化工作区旧身份目录清理失败');
    }

    const ensureOwnerCmd = `sudo chown -R ${escapeShellArg(params.sshLinuxUser)}:${MYCC_GROUP} ${escapeShellArg(homeDir)}`;
    const ensureOwner = await sshPool.exec(connection, ensureOwnerCmd);
    if (ensureOwner.exitCode !== 0) {
      console.error(`❌ Onboarding 权限修复失败 userId=${params.userId}: ${ensureOwner.stderr}`);
      throw new Error('初始化目录权限异常，请联系管理员');
    }
  } finally {
    sshPool.release(connection);
  }
}

async function prepareOnboardingWorkspaceWithE2b(params: {
  env: NodeJS.ProcessEnv;
  e2bProvider: OnboardingE2bProvider;
  ideSessionStore: IdeSessionStore;
  templateRoot?: string;
  userId: number;
  linuxUser: string;
  assistantName: string;
  ownerName: string;
}): Promise<{ linuxUser: string; workspaceDir: string }> {
  const plan = buildE2bCodeServerSessionPlan({
    userId: params.userId,
    linuxUser: params.linuxUser,
    workspaceDir: `/home/${params.linuxUser}/workspace`,
  }, params.env);
  const session = await ensureE2bIdeSession({
    userId: params.userId,
    linuxUser: params.linuxUser,
    workspaceDir: plan.workspaceDir,
    sessionStore: params.ideSessionStore,
    e2bProvider: params.e2bProvider,
    env: params.env,
    missingStartCodeServerMessage: 'E2B onboarding provider cannot create IDE sessions',
  });
  const templateRoot = resolveTemplateRoot(params.env, params.templateRoot);
  const claudeHomeDir = `/home/${plan.linuxUser}/.claude`;
  const claudeHomeFiles = listUserClaudeHomeTemplateFiles({
    templateRoot,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    includeBootstrapSentinel: false,
    overwrite: () => true,
  });
  const workspaceFiles = listUserWorkspaceTemplateFiles({
    templateRoot,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    includeBootstrapSentinel: false,
    overwrite: (relativePath) => relativePath === 'CLAUDE.md',
  });

  const claudeHomeResult = await params.e2bProvider.runCommandInSession(
    session,
    buildClaudeHomeTemplateSeedCommand({
      claudeHomeDir,
      files: claudeHomeFiles,
    }),
    {
      cwd: `/home/${plan.linuxUser}`,
      timeoutMs: E2B_ONBOARDING_SEED_TIMEOUT_MS,
    },
  );

  if (claudeHomeResult.exitCode !== 0) {
    throw new Error(claudeHomeResult.stderr || claudeHomeResult.error || 'E2B 初始化 Claude home 写入失败');
  }

  const workspaceResult = await params.e2bProvider.runCommandInSession(
    session,
    buildWorkspaceTemplateSeedCommand({
      workspaceDir: plan.workspaceDir,
      files: workspaceFiles,
    }),
    {
      cwd: plan.workspaceDir,
      timeoutMs: E2B_ONBOARDING_SEED_TIMEOUT_MS,
    },
  );

  if (workspaceResult.exitCode !== 0) {
    throw new Error(workspaceResult.stderr || workspaceResult.error || 'E2B 初始化工作区入口写入失败');
  }

  const cleanupResult = await params.e2bProvider.runCommandInSession(
    session,
    buildWorkspaceLegacyIdentityCleanupCommand(plan.workspaceDir),
    {
      cwd: plan.workspaceDir,
      timeoutMs: E2B_ONBOARDING_SEED_TIMEOUT_MS,
    },
  );

  if (cleanupResult.exitCode !== 0) {
    throw new Error(cleanupResult.stderr || cleanupResult.error || 'E2B 初始化工作区旧身份目录清理失败');
  }

  return {
    linuxUser: plan.linuxUser,
    workspaceDir: plan.workspaceDir,
  };
}

async function runOnboardingInitialization(params: {
  routeOptions: Required<OnboardingRoutesOptions>;
  user: OnboardingUser;
  userId: number;
  assistantName: string;
  ownerName: string;
}) {
  const linuxUser = sanitizeLinuxUsername(params.user.linux_user);
  const workspaceDir = `/home/${linuxUser}/workspace`;
  const prepareWithSsh = shouldPrepareOnboardingWorkspaceWithSsh(params.routeOptions.env);

  if (prepareWithSsh) {
    await prepareOnboardingWorkspaceWithSsh({
      env: params.routeOptions.env,
      templateRoot: params.routeOptions.templateRoot || undefined,
      sshLinuxUser: linuxUser,
      workspaceDir,
      assistantName: params.assistantName,
      ownerName: params.ownerName,
      userId: params.userId,
    });
  } else {
    await prepareOnboardingWorkspaceWithE2b({
      env: params.routeOptions.env,
      e2bProvider: params.routeOptions.e2bProvider,
      ideSessionStore: params.routeOptions.ideSessionStore,
      templateRoot: params.routeOptions.templateRoot || undefined,
      userId: params.userId,
      linuxUser,
      assistantName: params.assistantName,
      ownerName: params.ownerName,
    });
  }

  await markUserInitialized({
    userId: params.userId,
    assistantName: params.assistantName,
  });
}

function startOnboardingJob(params: {
  routeOptions: Required<OnboardingRoutesOptions>;
  user: OnboardingUser;
  userId: number;
  assistantName: string;
  ownerName: string;
}): OnboardingJob {
  const existing = onboardingJobs.get(params.userId);
  if (existing?.status === 'running') {
    return existing;
  }

  const now = Date.now();
  const job: OnboardingJob = {
    jobId: `onboarding_${params.userId}_${now.toString(36)}`,
    userId: params.userId,
    status: 'running',
    createdAt: now,
    updatedAt: now,
  };
  onboardingJobs.set(params.userId, job);

  setTimeout(() => {
    runOnboardingInitialization(params)
      .then(() => {
        job.status = 'ready';
        job.updatedAt = Date.now();
      })
      .catch((err) => {
        job.status = 'failed';
        job.error = publicOnboardingFailureResponse().error;
        job.updatedAt = Date.now();
        console.error('❌ Onboarding 异步初始化失败: initialization_unavailable', {
          reason: classifyOnboardingFailure(err),
        });
      });
  }, 0);

  return job;
}

function jobResponse(job: OnboardingJob): InitializeSuccessResponse {
  return {
    success: true,
    data: {
      status: job.status,
      jobId: job.jobId,
      ...(job.status === 'failed' ? { error: job.error || publicOnboardingFailureResponse().error } : {}),
    },
  };
}

export async function onboardingRoutes(fastify: FastifyInstance, options: OnboardingRoutesOptions = {}) {
  const routeOptions: Required<OnboardingRoutesOptions> = {
    env: options.env ?? process.env,
    e2bProvider: options.e2bProvider ?? new E2bSandboxProvider(),
    ideSessionStore: options.ideSessionStore ?? new PostgresIdeSessionStore(),
    templateRoot: options.templateRoot ?? '',
  };

  fastify.get('/api/onboarding/status', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    const user = await findUserById(request.user.userId);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: '初始化暂时没完成，请重新登录后再试',
        code: 'initialization_auth_unavailable',
      });
    }

    if (user.is_initialized) {
      onboardingJobs.delete(request.user.userId);
      return reply.send({
        success: true,
        data: {
          status: 'ready',
        },
      } satisfies InitializeSuccessResponse);
    }

    const job = onboardingJobs.get(request.user.userId);
    if (!job) {
      return reply.send({
        success: true,
        data: {
          status: 'idle',
        },
      } satisfies InitializeSuccessResponse);
    }

    return reply.send(jobResponse(job));
  });

  fastify.post('/api/onboarding/initialize', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: '未认证' });
    }

    try {
      const body = initializeSchema.parse(request.body);
      const user = await findUserById(request.user.userId);
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: '初始化暂时没完成，请重新登录后再试',
          code: 'initialization_auth_unavailable',
        });
      }

      if (user.is_initialized) {
        onboardingJobs.delete(request.user.userId);
        return reply.send({
          success: true,
          data: {
            status: 'ready',
          },
        } satisfies InitializeSuccessResponse);
      }

      const assistantName = body.assistantName.trim();
      const ownerName = body.ownerName.trim();

      if (shouldRunOnboardingAsync(routeOptions.env)) {
        const job = startOnboardingJob({
          routeOptions,
          user,
          userId: request.user.userId,
          assistantName,
          ownerName,
        });
        return reply.status(202).send(jobResponse(job));
      }

      await runOnboardingInitialization({
        routeOptions,
        user,
        userId: request.user.userId,
        assistantName,
        ownerName,
      });

      return reply.send({
        success: true,
        data: {
          status: 'ready',
        },
      } satisfies InitializeSuccessResponse);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '参数错误',
          details: err.issues,
        });
      }
      console.error('❌ Onboarding 失败: initialization_unavailable', {
        reason: classifyOnboardingFailure(err),
      });
      return reply.status(500).send(publicOnboardingFailureResponse());
    }
  });
}
