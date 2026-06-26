import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { findUserById, markUserInitialized } from '../db/client.js';
import { getSSHPool } from '../ssh/pool.js';
import { sanitizeLinuxUsername, escapeShellArg } from '../utils/validation.js';
import { clearExpiredOnboardingBootstrapTickets, issueOnboardingBootstrapTicket } from '../onboarding/bootstrap-ticket-store.js';
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

const CLAUDE_BOOTSTRAP_SENTINEL = '<!-- MYCC_BOOTSTRAP_REQUIRED -->';
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
    bootstrapPrompt: string;
  };
};
type OnboardingE2bProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>
  & Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;

export type OnboardingRoutesOptions = {
  env?: NodeJS.ProcessEnv;
  e2bProvider?: OnboardingE2bProvider;
  ideSessionStore?: IdeSessionStore;
  templateRoot?: string;
};

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

function buildLegacyGlobalMemoryPath(linuxUser: string): string {
  const projectUserSegment = linuxUser.replace(/_/g, '-');
  return `/home/${linuxUser}/.claude/projects/-home-${projectUserSegment}-workspace/memory/MEMORY.md`;
}

export function buildBootstrapPrompt(params: {
  assistantName: string;
  ownerName: string;
  linuxUser: string;
  bootstrapToken: string;
}): string {
  const assistantName = params.assistantName.trim();
  const ownerName = params.ownerName.trim();
  const workspaceDir = `/home/${params.linuxUser}/workspace`;
  const claudeHomeDir = `/home/${params.linuxUser}/.claude`;
  const legacyGlobalMemoryPath = buildLegacyGlobalMemoryPath(params.linuxUser);
  return [
    '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
    '',
    '关键原则（必须遵守）：',
    '- 以 `~/.claude/about-me/` 作为唯一身份真相源。',
    '- 工作区只保存工作区相关项目文件，不保存长期身份、记忆或内置 skills。',
    '- 如果发现任何历史文件与本次输入冲突，统一以本次输入为准并覆盖冲突值。',
    '',
    '请按顺序执行：',
    '1. 阅读并遵循 ~/.claude/about-me/BOOTSTRAP.md。',
    '2. 按以下信息个性化初始化：',
    `   - 助手名称：${assistantName}`,
    `   - 用户称呼：${ownerName}`,
    `   - 初始化票据：${params.bootstrapToken}`,
    '3. 更新 ~/.claude/about-me/IDENTITY.md、~/.claude/about-me/USER.md、~/.claude/about-me/MEMORY.md。',
    '   - 确保存在 ~/.claude/memory/ 目录，并写入一条当天初始化记录（YYYY-MM-DD.md）。',
    '4. 执行冲突对齐（必须）：',
    `   - 校验并修正 ${claudeHomeDir}/CLAUDE.md：保持它是用户级 Claude 入口，指向 ~/.claude/about-me/，不要把长期记忆写进 workspace。`,
    `   - 校验并修正 ${workspaceDir}/CLAUDE.md：保持它只是当前工作区入口文档，不写死助手名/用户称呼，不承载长期记忆。`,
    `   - 若 ${workspaceDir}/CLAUDE.md 中仍存在 ${CLAUDE_BOOTSTRAP_SENTINEL}，初始化成功后删除这一行；若未完成则保留。`,
    `   - 若 ${claudeHomeDir}/CLAUDE.md 中仍存在 ${CLAUDE_BOOTSTRAP_SENTINEL}，初始化成功后删除这一行；若未完成则保留。`,
    `   - 若 ${legacyGlobalMemoryPath} 存在：将“助手名称/对用户称呼/交互角色设定”同步为与 ~/.claude/about-me 一致。`,
    '   - 清理别名或旧称呼（如“旧助手名”“旧昵称”等）带来的同字段多真值。',
    '5. 初始化完成后，把 ~/.claude/about-me/BOOTSTRAP.md 归档到 ~/.claude/archive/bootstrap/，不要保留在原位置。',
    '',
    '输出要求：最后用简洁中文汇报“已完成初始化”，并列出你实际修改的文件路径与“冲突对齐结果”。',
  ].join('\n');
}

export function shouldPrepareOnboardingWorkspaceWithSsh(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MYCC_WORKSPACE_PROVIDER || 'ssh').trim() !== 'e2b';
}

function resolveTemplateRoot(env: NodeJS.ProcessEnv, explicitRoot?: string): string {
  if (explicitRoot) return explicitRoot;
  if (env.MYCC_USER_WORKSPACE_TEMPLATE_DIR) return env.MYCC_USER_WORKSPACE_TEMPLATE_DIR;
  if (fs.existsSync(REMOTE_TEMPLATE_DIR)) return REMOTE_TEMPLATE_DIR;
  return path.resolve(process.cwd(), 'templates/user-workspace');
}

async function prepareOnboardingWorkspaceWithSsh(params: {
  sshLinuxUser: string;
  workspaceDir: string;
  assistantName: string;
  ownerName: string;
  userId: number;
}) {
  const claudeMdPath = `${params.workspaceDir}/CLAUDE.md`;
  const templateDir = '/opt/mycc/templates/user-workspace';

  const sshPool = getSSHPool();
  const connection = await sshPool.acquire();

  try {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const preflightCmd = [
      `sudo test -d "${params.workspaceDir}"`,
      `sudo test -f "${claudeMdPath}"`,
    ].join(' && ');

    let preflight = await sshPool.exec(connection, preflightCmd);
    if (preflight.exitCode !== 0) {
      const repairCmd = [
        `getent group ${MYCC_GROUP} >/dev/null 2>&1 || sudo groupadd ${MYCC_GROUP}`,
        `(id ${escapeShellArg(params.sshLinuxUser)} >/dev/null 2>&1 || sudo useradd -m -g ${MYCC_GROUP} -s /bin/bash ${escapeShellArg(params.sshLinuxUser)} || true)`,
        `id ${escapeShellArg(params.sshLinuxUser)} >/dev/null 2>&1`,
        `sudo mkdir -p "${params.workspaceDir}"`,
        `sudo test -d "${templateDir}"`,
        `sudo cp -rn "${templateDir}/." "${params.workspaceDir}/"`,
        `sudo cp "${templateDir}/CLAUDE.md" "${claudeMdPath}"`,
        `sudo chown -R ${escapeShellArg(params.sshLinuxUser)}:${MYCC_GROUP} /home/${escapeShellArg(params.sshLinuxUser)}`,
      ].join(' && ');

      const repaired = await sshPool.exec(connection, repairCmd);
      if (repaired.exitCode !== 0) {
        console.error(`❌ Onboarding 自愈失败 userId=${params.userId} linuxUser=${params.sshLinuxUser}: ${repaired.stderr}`);
      }

      for (let i = 0; i < 8; i += 1) {
        preflight = await sshPool.exec(connection, preflightCmd);
        if (preflight.exitCode === 0) break;
        await sleep(500);
      }

      if (preflight.exitCode !== 0) {
        console.error(`❌ Onboarding 目录或模板异常 userId=${params.userId} linuxUser=${params.sshLinuxUser} path=${claudeMdPath}`);
        throw new Error('初始化目录或模板异常，请联系管理员');
      }
    }

    const assistantB64 = Buffer.from(params.assistantName.trim()).toString('base64');
    const ownerB64 = Buffer.from(params.ownerName.trim()).toString('base64');
    const sentinelB64 = Buffer.from(CLAUDE_BOOTSTRAP_SENTINEL).toString('base64');
    const prepareClaudeScript = [
      'const fs=require("fs");',
      `const file=${JSON.stringify(claudeMdPath)};`,
      `const assistant=Buffer.from(${JSON.stringify(assistantB64)},"base64").toString();`,
      `const owner=Buffer.from(${JSON.stringify(ownerB64)},"base64").toString();`,
      `const sentinel=Buffer.from(${JSON.stringify(sentinelB64)},"base64").toString();`,
      'let content=fs.readFileSync(file,"utf8");',
      'content=content.split("{{ASSISTANT_NAME}}").join(assistant);',
      'content=content.split("{{OWNER_NAME}}").join(owner);',
      'content=content.split("{{USERNAME}}").join(owner);',
      'if(!content.includes(sentinel)){',
      '  content=`${sentinel}\n${content}`;',
      '}',
      'fs.writeFileSync(file,content);',
    ].join('');
    const prepared = await sshPool.exec(
      connection,
      `sudo -n -u ${escapeShellArg(params.sshLinuxUser)} node -e '${prepareClaudeScript}'`
    );
    if (prepared.exitCode !== 0) {
      console.error(`❌ Onboarding CLAUDE 准备失败 userId=${params.userId} linuxUser=${params.sshLinuxUser}: ${prepared.stderr}`);
      throw new Error('初始化文件写入失败，请重试');
    }

    const ensureOwnerCmd = `sudo chown -R ${escapeShellArg(params.sshLinuxUser)}:${MYCC_GROUP} "${params.workspaceDir}"`;
    const ensureOwner = await sshPool.exec(connection, ensureOwnerCmd);
    if (ensureOwner.exitCode !== 0) {
      console.error(`❌ Onboarding 权限修复失败 userId=${params.userId} linuxUser=${params.sshLinuxUser}: ${ensureOwner.stderr}`);
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
    includeBootstrapSentinel: true,
    overwrite: () => true,
  });
  const workspaceFiles = listUserWorkspaceTemplateFiles({
    templateRoot,
    assistantName: params.assistantName,
    ownerName: params.ownerName,
    includeBootstrapSentinel: true,
    overwrite: (relativePath) => relativePath === 'CLAUDE.md',
  });

  const claudeHomeResult = await params.e2bProvider.runCommandInSession(
    session,
    buildClaudeHomeTemplateSeedCommand({
      claudeHomeDir,
      files: claudeHomeFiles,
    }),
    {
      cwd: claudeHomeDir,
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

  return {
    linuxUser: plan.linuxUser,
    workspaceDir: plan.workspaceDir,
  };
}

export async function onboardingRoutes(fastify: FastifyInstance, options: OnboardingRoutesOptions = {}) {
  const routeOptions: Required<OnboardingRoutesOptions> = {
    env: options.env ?? process.env,
    e2bProvider: options.e2bProvider ?? new E2bSandboxProvider(),
    ideSessionStore: options.ideSessionStore ?? new PostgresIdeSessionStore(),
    templateRoot: options.templateRoot ?? '',
  };

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
        return reply.status(404).send({ success: false, error: '用户不存在' });
      }

      if (user.is_initialized) {
        return reply.send({ success: true, message: '已初始化' });
      }

      const linuxUser = sanitizeLinuxUsername(user.linux_user);
      const workspaceDir = `/home/${linuxUser}/workspace`;
      let bootstrapLinuxUser = linuxUser;
      const prepareWithSsh = shouldPrepareOnboardingWorkspaceWithSsh(routeOptions.env);

      if (prepareWithSsh) {
        await prepareOnboardingWorkspaceWithSsh({
          sshLinuxUser: linuxUser,
          workspaceDir,
          assistantName: body.assistantName,
          ownerName: body.ownerName,
          userId: request.user.userId,
        });
      } else {
        const prepared = await prepareOnboardingWorkspaceWithE2b({
          env: routeOptions.env,
          e2bProvider: routeOptions.e2bProvider,
          ideSessionStore: routeOptions.ideSessionStore,
          templateRoot: routeOptions.templateRoot || undefined,
          userId: request.user.userId,
          linuxUser,
          assistantName: body.assistantName.trim(),
          ownerName: body.ownerName.trim(),
        });
        bootstrapLinuxUser = prepared.linuxUser;
      }

      clearExpiredOnboardingBootstrapTickets();
      const ticket = issueOnboardingBootstrapTicket({
        userId: request.user.userId,
        assistantName: body.assistantName.trim(),
        ownerName: body.ownerName.trim(),
      });
      if (prepareWithSsh) {
        await markUserInitialized({
          userId: request.user.userId,
          assistantName: body.assistantName.trim(),
        });
      }
      const bootstrapPrompt = buildBootstrapPrompt({
        assistantName: body.assistantName,
        ownerName: body.ownerName,
        linuxUser: bootstrapLinuxUser,
        bootstrapToken: ticket.token,
      });

      return reply.send({
        success: true,
        data: {
          bootstrapPrompt,
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
