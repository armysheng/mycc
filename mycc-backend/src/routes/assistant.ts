import type { FastifyInstance } from 'fastify';
import { findUserById as defaultFindUserById, getUserConversations as defaultGetUserConversations } from '../db/client.js';
import type { ConversationSummary, User } from '../db/client.js';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from '../ide/service.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
  type StoredIdeSession,
} from '../ide/session-store.js';
import { escapeShellArg } from '../utils/validation.js';

export type AssistantTaskStatus = 'recent' | 'active' | 'waiting' | 'needs_workspace';

type E2bAssistantWorkspaceProvider = Pick<E2bSandboxProvider, 'runCommandInSession'>;

export type AssistantRoutesOptions = {
  getUserConversations?: (
    userId: number,
    limit?: number,
    offset?: number,
  ) => Promise<ConversationSummary[]>;
  findUserById?: (userId: number) => Promise<User | null>;
  sessionStore?: IdeSessionStore;
  e2bProvider?: E2bAssistantWorkspaceProvider;
  env?: NodeJS.ProcessEnv;
};

type AssistantMemorySource = {
  kind: 'profile' | 'project_context' | 'runtime_memory';
  label: string;
  status: 'available' | 'available_when_workspace_running' | 'managed_by_runtime' | 'missing';
  editable: boolean;
  description: string;
};

type AssistantDeliverableEmptyState = {
  title: string;
  description: string;
};

type WorkspaceDeliverableCandidate = {
  path?: unknown;
  title?: unknown;
  size?: unknown;
  mtime?: unknown;
};

type AssistantDeliverableCard = {
  id: string;
  kind: 'document' | 'code_change' | 'diff' | 'report' | 'link' | 'preview' | 'screenshot' | 'log' | 'pr' | 'dataset';
  title: string;
  source: 'current_workspace' | 'current_conversation';
  status: 'ready' | 'pending' | 'error';
  description?: string;
  path?: string;
  url?: string;
  updatedAt?: string;
};

const DELIVERABLE_SCAN_SCRIPT = [
  '/* DELIVERABLE_SCAN_SCRIPT */',
  'const fs=require("fs");',
  'const path=require("path");',
  'const root=path.resolve(process.argv[1]||process.cwd());',
  'const rootReal=fs.realpathSync(root);',
  'const maxDepth=5;',
  'const maxItems=16;',
  'const ignoreDirs=new Set([".git",".claude",".config",".ssh","node_modules","dist","build","coverage",".next",".vite"]);',
  'const deliverableWords=["report","summary","spec","plan","proposal","design","research","review","deliverable","artifact","报告","总结","方案","计划","规划","调研","设计","复盘","制品","交付"];',
  'const secretWords=[".env","secret","token","credential","password","passwd","private","apikey","api_key","auth"];',
  'const out=[];',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'const safe=(rel)=>{const lower=rel.toLowerCase();return !secretWords.some((word)=>lower.includes(word));};',
  'const useful=(rel)=>{const lower=rel.toLowerCase();return deliverableWords.some((word)=>lower.includes(word));};',
  'const title=(rel)=>path.basename(rel).replace(/\\.md$/i,"").replace(/[-_]+/g," ").trim()||path.basename(rel);',
  'function walk(abs,depth){',
  '  if(out.length>=maxItems||depth>maxDepth)return;',
  '  let entries;',
  '  try{entries=fs.readdirSync(abs,{withFileTypes:true});}catch{return;}',
  '  entries.sort((a,b)=>a.name.localeCompare(b.name,"zh-Hans-CN"));',
  '  for(const entry of entries){',
  '    if(out.length>=maxItems)break;',
  '    if(entry.name.startsWith("."))continue;',
  '    const full=path.join(abs,entry.name);',
  '    let stat;',
  '    try{stat=fs.lstatSync(full);}catch{continue;}',
  '    if(stat.isSymbolicLink())continue;',
  '    let real;',
  '    try{real=fs.realpathSync(full);}catch{continue;}',
  '    if(!inside(rootReal,real))continue;',
  '    const rel=path.relative(rootReal,real).split(path.sep).join("/");',
  '    if(stat.isDirectory()){',
  '      if(ignoreDirs.has(entry.name))continue;',
  '      walk(real,depth+1);',
  '      continue;',
  '    }',
  '    if(!entry.name.toLowerCase().endsWith(".md"))continue;',
  '    if(!safe(rel)||!useful(rel))continue;',
  '    out.push({path:"/"+rel,title:title(rel),size:stat.size,mtime:new Date(stat.mtimeMs).toISOString()});',
  '  }',
  '}',
  'walk(rootReal,0);',
  'process.stdout.write(JSON.stringify(out));',
].join('');

export async function assistantRoutes(
  fastify: FastifyInstance,
  options: AssistantRoutesOptions = {},
) {
  const getUserConversations = options.getUserConversations ?? defaultGetUserConversations;
  const findUserById = options.findUserById ?? defaultFindUserById;
  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const env = options.env ?? process.env;

  fastify.get('/api/assistant/home', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    const user = await findUserById(request.user.userId);
    const conversations = await getUserConversations(request.user.userId, 6, 0);
    const session = await sessionStore.findReusableByUser(request.user.userId);
    const memory = buildMemorySources(user, Boolean(session));
    const deliverables = await collectWorkspaceDeliverables({
      userId: request.user.userId,
      linuxUser: user?.linux_user ?? request.user.linuxUser,
      session,
      e2bProvider,
      env,
    });

    return {
      success: true,
      data: {
        assistant: {
          name: user?.assistant_name?.trim() || 'cc',
          initialized: Boolean(user?.is_initialized),
        },
        tasks: conversations.map(toTaskCard),
        deliverables,
        deliverableEmptyState: deliverableEmptyState(),
        memory: {
          sources: memory,
        },
        workspace: toWorkspaceSummary(session),
        capabilities: buildCapabilities(session),
        emptyStates: {
          tasks: 'Start by asking your assistant to do something. Recent conversations will appear here.',
          deliverables: 'Useful outputs like reports, files, previews, and PRs will appear here after the assistant produces them.',
          memory: 'Your assistant can become more useful when it knows your preferences and project context.',
          workspace: 'Create a workspace when you want the assistant to work with files or code.',
        },
      },
    };
  });

  fastify.get('/api/assistant/memory', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    const user = await findUserById(request.user.userId);
    const session = await sessionStore.findReusableByUser(request.user.userId);

    return {
      success: true,
      data: {
        sources: buildMemorySources(user, Boolean(session)),
      },
    };
  });

  fastify.get('/api/assistant/deliverables', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: '未认证' });
    }

    const user = await findUserById(request.user.userId);
    const session = await sessionStore.findReusableByUser(request.user.userId);
    const deliverables = await collectWorkspaceDeliverables({
      userId: request.user.userId,
      linuxUser: user?.linux_user ?? request.user.linuxUser,
      session,
      e2bProvider,
      env,
    });

    return {
      success: true,
      data: {
        deliverables,
        emptyState: deliverableEmptyState(),
      },
    };
  });
}

function toTaskCard(conversation: ConversationSummary) {
  return {
    id: conversation.sessionId,
    source: 'conversation' as const,
    status: 'recent' as AssistantTaskStatus,
    title: conversation.title || '未命名会话',
    messageCount: conversation.messageCount,
    totalTokens: conversation.totalTokens,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    description: '最近会话，可继续让助理接着处理。',
  };
}

function buildMemorySources(
  user: User | null,
  hasWorkspace: boolean,
): AssistantMemorySource[] {
  return [
    {
      kind: 'profile',
      label: '个人偏好',
      status: user ? 'available' : 'missing',
      editable: true,
      description: user?.assistant_name
        ? `助理名：${user.assistant_name}`
        : '基础身份、助理名称和初始化状态。',
    },
    {
      kind: 'project_context',
      label: '项目背景',
      status: hasWorkspace ? 'available' : 'available_when_workspace_running',
      editable: false,
      description: '来自当前活跃工作区的项目背景，例如 0-System/about-me 和 memory 文件。',
    },
    {
      kind: 'runtime_memory',
      label: '长期记忆',
      status: 'managed_by_runtime',
      editable: false,
      description: '助理在长期协作中积累的偏好、事实和约定，当前以只读来源展示。',
    },
  ];
}

function toWorkspaceSummary(session: StoredIdeSession | null) {
  if (!session) {
    return {
      status: 'needs_workspace',
      label: '当前没有活跃工作区',
      description: '创建工作区后，助理可以处理文件和代码。',
    };
  }

  return {
    status: session.status,
    label: '当前活跃工作区',
    description: '这个工作区由当前用户的助理任务共享；切换会话不会默认创建新环境。',
    expiresAt: session.expiresAt,
  };
}

function buildCapabilities(session: StoredIdeSession | null) {
  return [
    {
      id: 'code-server',
      label: '代码编辑器',
      status: session?.status === 'running' ? 'running' : 'needs_workspace',
      description: '高级接管入口。需要深度编辑代码时再打开。',
      actionLabel: session?.status === 'running' ? '打开代码编辑器' : '创建工作区',
    },
    {
      id: 'desktop',
      label: '云桌面',
      status: 'disabled',
      description: 'GNU 图形桌面能力正在单独设计，v0 默认隐藏。',
      actionLabel: '暂未启用',
      hidden: true,
    },
  ];
}

async function collectWorkspaceDeliverables(params: {
  userId: number;
  linuxUser: string;
  session: StoredIdeSession | null;
  e2bProvider: E2bAssistantWorkspaceProvider;
  env: NodeJS.ProcessEnv;
}): Promise<AssistantDeliverableCard[]> {
  if (!params.session || params.session.provider !== 'e2b') {
    return [];
  }

  try {
    const plan = buildE2bCodeServerSessionPlan({
      userId: params.userId,
      linuxUser: params.linuxUser,
      workspaceDir: `/home/${params.linuxUser}/workspace`,
    }, params.env);
    const command = `node -e ${escapeShellArg(DELIVERABLE_SCAN_SCRIPT)} -- ${escapeShellArg(plan.workspaceDir)}`;
    const result = await params.e2bProvider.runCommandInSession(params.session, command, {
      cwd: plan.workspaceDir,
      timeoutMs: 8000,
    });

    if (result.exitCode !== 0 || !result.stdout?.trim()) {
      return [];
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return toWorkspaceDeliverableCards(parsed as WorkspaceDeliverableCandidate[]);
  } catch {
    return [];
  }
}

export function toWorkspaceDeliverableCards(
  candidates: WorkspaceDeliverableCandidate[],
): AssistantDeliverableCard[] {
  const seen = new Set<string>();
  const cards: AssistantDeliverableCard[] = [];

  for (const candidate of candidates) {
    const path = typeof candidate.path === 'string' ? candidate.path : '';
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    if (!isSafeWorkspaceDeliverablePath(path) || !isUsefulDeliverableCandidate(path, title)) {
      continue;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);

    const updatedAt = typeof candidate.mtime === 'string' && !Number.isNaN(new Date(candidate.mtime).getTime())
      ? new Date(candidate.mtime).toISOString()
      : undefined;
    const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size)
      ? candidate.size
      : null;

    cards.push({
      id: `workspace:${normalizedPath}`,
      kind: inferDeliverableKind(normalizedPath, title),
      title: title || deriveTitleFromPath(normalizedPath),
      source: 'current_workspace',
      status: 'ready',
      path: normalizedPath,
      ...(updatedAt ? { updatedAt } : {}),
      ...(size ? { description: `${Math.ceil(size / 1024)} KB · 来自当前工作区` } : { description: '来自当前工作区' }),
    });
  }

  return cards.slice(0, 8);
}

function isSafeWorkspaceDeliverablePath(rawPath: string): boolean {
  if (!rawPath || rawPath.includes('\0')) {
    return false;
  }

  const normalized = rawPath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (!lower.endsWith('.md')) {
    return false;
  }
  if (normalized.split('/').some((part) => part.startsWith('.') && part !== '')) {
    return false;
  }

  return ![
    '.env',
    'secret',
    'token',
    'credential',
    'password',
    'passwd',
    'private',
    'apikey',
    'api_key',
    'auth',
  ].some((word) => lower.includes(word));
}

function isUsefulDeliverableCandidate(path: string, title: string): boolean {
  const haystack = `${path} ${title}`.toLowerCase();
  return [
    'report',
    'summary',
    'spec',
    'plan',
    'proposal',
    'design',
    'research',
    'review',
    'deliverable',
    'artifact',
    '报告',
    '总结',
    '方案',
    '计划',
    '规划',
    '调研',
    '设计',
    '复盘',
    '制品',
    '交付',
  ].some((word) => haystack.includes(word));
}

function inferDeliverableKind(path: string, title: string): AssistantDeliverableCard['kind'] {
  const haystack = `${path} ${title}`.toLowerCase();
  if (['report', 'research', 'review', '调研', '报告', '复盘'].some((word) => haystack.includes(word))) {
    return 'report';
  }
  return 'document';
}

function deriveTitleFromPath(path: string): string {
  const file = path.split('/').filter(Boolean).at(-1) || path;
  return file.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim() || file;
}

function deliverableEmptyState(): AssistantDeliverableEmptyState {
  return {
    title: '还没有制品',
    description: '助理产出的报告、文件、预览、PR 和日志会在这里出现。',
  };
}
