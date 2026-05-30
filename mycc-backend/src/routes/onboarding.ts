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

type TemplateSeedFile = {
  path: string;
  contentBase64: string;
  overwrite: boolean;
};

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
  const legacyGlobalMemoryPath = buildLegacyGlobalMemoryPath(params.linuxUser);
  return [
    '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
    '',
    '关键原则（必须遵守）：',
    '- 以 `0-System/about-me/` 作为唯一身份真相源。',
    '- 如果发现任何历史文件与本次输入冲突，统一以本次输入为准并覆盖冲突值。',
    '',
    '请按顺序执行：',
    '1. 阅读并遵循 0-System/about-me/BOOTSTRAP.md。',
    '2. 按以下信息个性化初始化：',
    `   - 助手名称：${assistantName}`,
    `   - 用户称呼：${ownerName}`,
    `   - 初始化票据：${params.bootstrapToken}`,
    '3. 更新 0-System/about-me/IDENTITY.md、0-System/about-me/USER.md、0-System/about-me/MEMORY.md。',
    '   - 确保存在 0-System/memory/ 目录，并写入一条当天初始化记录（YYYY-MM-DD.md）。',
    '4. 执行冲突对齐（必须）：',
    `   - 校验并修正 ${workspaceDir}/CLAUDE.md：保持它是工作区唯一入口文档，但不要写死助手名/用户称呼。`,
    `   - 若 ${workspaceDir}/CLAUDE.md 中仍存在 ${CLAUDE_BOOTSTRAP_SENTINEL}，初始化成功后删除这一行；若未完成则保留。`,
    `   - 若 ${legacyGlobalMemoryPath} 存在：将“助手名称/对用户称呼/交互角色设定”同步为与 about-me 一致。`,
    '   - 清理别名或旧称呼（如“小花”“大辉哥”等）带来的同字段多真值。',
    '5. 初始化完成后，把 0-System/about-me/BOOTSTRAP.md 归档到 5-Archive/bootstrap/，不要保留在原位置。',
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

function listTemplateFiles(params: {
  templateRoot: string;
  assistantName: string;
  ownerName: string;
}): TemplateSeedFile[] {
  const root = path.resolve(params.templateRoot);
  if (!fs.existsSync(root)) {
    throw new Error(`用户工作区模板不存在: ${root}`);
  }

  const files: TemplateSeedFile[] = [];
  const visit = (absoluteDir: string, relativeDir = '') => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .filter((entry) => entry.name !== '.DS_Store')
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = relativeDir
        ? path.posix.join(relativeDir, entry.name)
        : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      let content = fs.readFileSync(absolutePath, 'utf8');
      content = content
        .replaceAll('{{ASSISTANT_NAME}}', params.assistantName)
        .replaceAll('{{OWNER_NAME}}', params.ownerName)
        .replaceAll('{{USERNAME}}', params.ownerName);
      if (relativePath === 'CLAUDE.md' && !content.includes(CLAUDE_BOOTSTRAP_SENTINEL)) {
        content = `${CLAUDE_BOOTSTRAP_SENTINEL}\n${content}`;
      }

      files.push({
        path: relativePath,
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
        overwrite: relativePath === 'CLAUDE.md',
      });
    }
  };

  visit(root);
  return files;
}

function buildE2bWorkspaceSeedCommand(params: {
  workspaceDir: string;
  files: TemplateSeedFile[];
}): string {
  const script = [
    'const fs=require("fs");',
    'const path=require("path");',
    `const workspaceDir=${JSON.stringify(params.workspaceDir)};`,
    `const files=${JSON.stringify(params.files)};`,
    'const root=path.resolve(workspaceDir);',
    'const inside=(target)=>target===root||target.startsWith(root+path.sep);',
    'fs.mkdirSync(root,{recursive:true});',
    'for(const file of files){',
    '  const rel=String(file.path||"").replace(/^\\/+/, "");',
    '  const target=path.resolve(root,rel);',
    '  if(!inside(target)) throw new Error(`path-outside-workspace:${rel}`);',
    '  fs.mkdirSync(path.dirname(target),{recursive:true});',
    '  if(!fs.existsSync(target)||file.overwrite){',
    '    fs.writeFileSync(target,Buffer.from(file.contentBase64,"base64").toString("utf8"));',
    '  }',
    '}',
    'for(const rel of ["0-System/memory","5-Archive/bootstrap"]){',
    '  const target=path.resolve(root,rel);',
    '  if(!inside(target)) throw new Error(`path-outside-workspace:${rel}`);',
    '  fs.mkdirSync(target,{recursive:true});',
    '}',
    'process.stdout.write("seeded");',
  ].join('\n');

  return `node <<'MYCC_E2B_ONBOARDING_SEED'\n${script}\nMYCC_E2B_ONBOARDING_SEED`;
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
  const files = listTemplateFiles({
    templateRoot: resolveTemplateRoot(params.env, params.templateRoot),
    assistantName: params.assistantName,
    ownerName: params.ownerName,
  });
  const result = await params.e2bProvider.runCommandInSession(
    session,
    buildE2bWorkspaceSeedCommand({
      workspaceDir: plan.workspaceDir,
      files,
    }),
    {
      cwd: plan.workspaceDir,
      timeoutMs: E2B_ONBOARDING_SEED_TIMEOUT_MS,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.error || 'E2B 初始化文件写入失败');
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
      console.error('❌ Onboarding 失败:', err);
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '初始化失败',
      });
    }
  });
}
