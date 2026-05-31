import type { FastifyInstance } from 'fastify';
import { findUserById as defaultFindUserById, getUserConversations as defaultGetUserConversations } from '../db/client.js';
import type { ConversationSummary, User } from '../db/client.js';
import { isUserVisibleConversation } from '../chat/conversation-visibility.js';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from '../ide/service.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
  type StoredIdeSession,
} from '../ide/session-store.js';
import { escapeShellArg } from '../utils/validation.js';

export type AssistantTaskStatus = 'recent' | 'active' | 'waiting';

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
  kind: 'profile' | 'project_context' | 'long_term_memory';
  label: string;
  status: 'available' | 'pending' | 'managed' | 'missing';
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
  kind?: unknown;
  status?: unknown;
  description?: unknown;
  url?: unknown;
  size?: unknown;
  mtime?: unknown;
  updatedAt?: unknown;
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
  'const manifestPath=path.join(rootReal,".mycc","deliverables.json");',
  'const maxDepth=5;',
  'const maxItems=16;',
  'const ignoreDirs=new Set([".git",".claude",".config",".ssh","node_modules","dist","build","coverage",".next",".vite"]);',
  'const deliverableWords=["report","summary","spec","plan","proposal","design","research","review","deliverable","artifact","preview","screenshot","log","diff","patch","dataset","data","spreadsheet","报告","总结","方案","计划","规划","调研","设计","复盘","制品","交付","预览","截图","日志","数据","数据集","表格"];',
  'const deliverableExts=new Set([".md",".pdf",".doc",".docx",".ppt",".pptx",".xls",".xlsx",".csv",".tsv",".html",".htm",".png",".jpg",".jpeg",".webp",".svg",".log",".txt",".diff",".patch"]);',
  'const secretWords=[".env","secret","token","credential","password","passwd","private","apikey","api_key","auth"];',
  'const out=[];',
  'const inside=(base,p)=>p===base||p.startsWith(base+path.sep);',
  'const safe=(rel)=>{const lower=rel.toLowerCase();return !secretWords.some((word)=>lower.includes(word));};',
  'const useful=(rel)=>{const lower=rel.toLowerCase();return deliverableWords.some((word)=>lower.includes(word));};',
  'const title=(rel)=>path.basename(rel).replace(/\\.md$/i,"").replace(/[-_]+/g," ").trim()||path.basename(rel);',
  'const relPath=(value)=>{',
  '  if(typeof value!=="string"||!value.trim())return "";',
  '  const raw=value.replace(/\\\\/g,"/");',
  '  const abs=path.isAbsolute(raw)?path.resolve(raw):path.resolve(rootReal,raw);',
  '  let real=abs;',
  '  try{real=fs.existsSync(abs)?fs.realpathSync(abs):abs;}catch{}',
  '  if(!inside(rootReal,real))return "";',
  '  return "/"+path.relative(rootReal,real).split(path.sep).join("/");',
  '};',
  'let manifest;',
  'let manifestError;',
  'try{',
  '  if(fs.existsSync(manifestPath)){',
  '    const parsed=JSON.parse(fs.readFileSync(manifestPath,"utf8"));',
  '    const entries=Array.isArray(parsed)?parsed:(Array.isArray(parsed.deliverables)?parsed.deliverables:(Array.isArray(parsed.items)?parsed.items:[]));',
  '    manifest=entries.map((entry)=>entry&&typeof entry==="object"?{...entry,path:relPath(entry.path)}:entry);',
  '  }',
  '}catch(error){manifestError=error&&error.message?String(error.message):"manifest parse failed";}',
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
  '    if(!deliverableExts.has(path.extname(entry.name).toLowerCase()))continue;',
  '    if(!safe(rel)||!useful(rel))continue;',
  '    out.push({path:"/"+rel,title:title(rel),size:stat.size,mtime:new Date(stat.mtimeMs).toISOString()});',
  '  }',
  '}',
  'walk(rootReal,0);',
  'process.stdout.write(JSON.stringify({manifest,manifestError,scan:out}));',
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
    const conversations = (await getUserConversations(request.user.userId, 12, 0))
      .filter(isUserVisibleConversation)
      .slice(0, 6);
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
          tasks: '告诉助理你想完成什么，最近对话会出现在这里。',
          deliverables: '助理产出的报告、文件、预览和协作记录会出现在这里。',
          memory: '补充偏好和项目背景后，助理会更懂你的工作方式。',
          workspace: '需要处理文件或代码时，助理会准备项目空间。',
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
      status: hasWorkspace ? 'available' : 'pending',
      editable: false,
      description: hasWorkspace
        ? '来自当前项目空间的项目背景和工作约定。'
        : '项目空间准备好后，会自动读取当前项目背景。',
    },
    {
      kind: 'long_term_memory',
      label: '长期记忆',
      status: 'managed',
      editable: false,
      description: '助理会在长期协作中沉淀偏好、事实和约定。',
    },
  ];
}

function toWorkspaceSummary(session: StoredIdeSession | null) {
  if (!session || session.status !== 'running') {
    return {
      status: 'inactive',
      label: '当前没有活跃项目空间',
      description: '需要处理文件或代码时，助理会准备项目空间。',
    };
  }

  return {
    status: 'active',
    label: '当前活跃项目空间',
    description: '这个项目空间由当前用户的助理任务共享；切换对话不会默认创建新环境。',
    expiresAt: session.expiresAt,
  };
}

function buildCapabilities(session: StoredIdeSession | null) {
  const workbenchAvailable = session?.status === 'running';
  return [
    {
      id: 'workbench',
      label: '工作间',
      status: workbenchAvailable ? 'available' : 'disabled',
      description: '需要深度接管文件、预览或复杂修改时再打开。',
      actionLabel: workbenchAvailable ? '打开工作间' : '准备工作间',
    },
    {
      id: 'desktop',
      label: '桌面工作间',
      status: 'disabled',
      description: '桌面工作间能力正在单独设计，默认隐藏。',
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

    return parseWorkspaceDeliverablesPayload(JSON.parse(result.stdout) as unknown);
  } catch {
    return [];
  }
}

export function toWorkspaceDeliverableCards(
  candidates: WorkspaceDeliverableCandidate[],
  options: { requireUseful?: boolean; preserveOrder?: boolean } = {},
): AssistantDeliverableCard[] {
  const seen = new Set<string>();
  const cards: AssistantDeliverableCard[] = [];
  const requireUseful = options.requireUseful ?? true;
  const orderedCandidates = options.preserveOrder ? candidates : sortDeliverableCandidates(candidates);

  for (const candidate of orderedCandidates) {
    const path = typeof candidate.path === 'string' ? candidate.path : '';
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const description = typeof candidate.description === 'string'
      ? candidate.description.trim()
      : '';
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
    if (
      !isSafeWorkspaceDeliverablePath(path)
      || (requireUseful && !isUsefulDeliverableCandidate(path, title))
      || !isSafeDeliverableText(title)
      || !isSafeDeliverableText(description)
      || (url && !isSafeDeliverableUrl(url))
    ) {
      continue;
    }

    const normalizedPath = normalizeWorkspaceDeliverablePath(path);
    if (!normalizedPath) {
      continue;
    }
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);

    const timestamp = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : candidate.mtime;
    const updatedAt = typeof timestamp === 'string' && !Number.isNaN(new Date(timestamp).getTime())
      ? new Date(timestamp).toISOString()
      : undefined;
    const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size)
      ? candidate.size
      : null;
    const kind = isDeliverableKind(candidate.kind)
      ? candidate.kind
      : inferDeliverableKind(normalizedPath, title);
    const status = isDeliverableStatus(candidate.status) ? candidate.status : 'ready';
    const safeDescription = description || (size ? `${Math.ceil(size / 1024)} KB · 来自当前工作区` : '来自当前工作区');

    cards.push({
      id: `workspace:${normalizedPath}`,
      kind,
      title: title || deriveTitleFromPath(normalizedPath),
      source: 'current_workspace',
      status,
      path: normalizedPath,
      ...(url ? { url } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      description: safeDescription,
    });
  }

  return cards.slice(0, 8);
}

function parseWorkspaceDeliverablesPayload(parsed: unknown): AssistantDeliverableCard[] {
  if (Array.isArray(parsed)) {
    return toWorkspaceDeliverableCards(parsed as WorkspaceDeliverableCandidate[]);
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const payload = parsed as {
    manifest?: unknown;
    manifestError?: unknown;
    scan?: unknown;
  };
  const scanCandidates = Array.isArray(payload.scan)
    ? payload.scan as WorkspaceDeliverableCandidate[]
    : [];
  if (payload.manifestError) {
    return toWorkspaceDeliverableCards(scanCandidates);
  }

  const manifestCandidates = Array.isArray(payload.manifest)
    ? payload.manifest as WorkspaceDeliverableCandidate[]
    : [];
  return mergeDeliverableCards([
    ...toWorkspaceDeliverableCards(manifestCandidates, { preserveOrder: true }),
    ...toWorkspaceDeliverableCards(scanCandidates),
  ]);
}

function mergeDeliverableCards(cards: AssistantDeliverableCard[]): AssistantDeliverableCard[] {
  const seen = new Set<string>();
  const merged: AssistantDeliverableCard[] = [];

  for (const card of cards) {
    const key = card.path ?? card.url ?? card.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(card);
  }

  return merged.slice(0, 8);
}

function isSafeWorkspaceDeliverablePath(rawPath: string): boolean {
  if (!rawPath || rawPath.includes('\0')) {
    return false;
  }

  const normalized = rawPath.replace(/\\/g, '/');
  if (normalized.includes(':') || normalized.startsWith('//') || normalized.startsWith('/home/')) {
    return false;
  }
  if (normalized.split('/').some((part) => part === '..')) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (!isSupportedDeliverablePath(lower)) {
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

function normalizeWorkspaceDeliverablePath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    return null;
  }

  return `/${normalized}`;
}

function isSafeDeliverableText(value: string): boolean {
  if (!value) {
    return true;
  }
  const lower = value.toLowerCase();
  return ![
    'secret',
    'token',
    'credential',
    'password',
    'passwd',
    'apikey',
    'api_key',
    'authorization',
    'e2b_live_',
    'sk-',
  ].some((word) => lower.includes(word));
}

function isSafeDeliverableUrl(rawUrl: string): boolean {
  if (!isSafeDeliverableText(rawUrl)) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(rawUrl, 'http://mycc.local');
  } catch {
    return false;
  }

  if (url.origin !== 'http://mycc.local') {
    return false;
  }

  if (!['/workspace', '/api/workspace/file'].includes(url.pathname)) {
    return false;
  }

  return !Array.from(url.searchParams.keys()).some((key) => {
    const lower = key.toLowerCase();
    return ['token', 'access_token', 'auth', 'key', 'secret', 'password'].some((word) => lower.includes(word));
  });
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
    'preview',
    'screenshot',
    'log',
    'diff',
    'patch',
    'dataset',
    'data',
    'spreadsheet',
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
    '预览',
    '截图',
    '日志',
    '数据',
    '数据集',
    '表格',
  ].some((word) => haystack.includes(word));
}

function inferDeliverableKind(path: string, title: string): AssistantDeliverableCard['kind'] {
  const haystack = `${path} ${title}`.toLowerCase();
  if (
    /\.(csv|tsv|xls|xlsx)$/i.test(path)
    || ['dataset', 'data', 'spreadsheet', '数据', '数据集', '表格'].some((word) => haystack.includes(word))
  ) {
    return 'dataset';
  }
  if (/\.(diff|patch)$/i.test(path) || ['diff', 'patch'].some((word) => haystack.includes(word))) {
    return 'diff';
  }
  if (/\.(log|txt)$/i.test(path) || ['log', '日志'].some((word) => haystack.includes(word))) {
    return 'log';
  }
  if (/\.(png|jpe?g|webp|svg)$/i.test(path) || ['screenshot', '截图'].some((word) => haystack.includes(word))) {
    return 'screenshot';
  }
  if (/\.(html?)$/i.test(path) || ['preview', '预览'].some((word) => haystack.includes(word))) {
    return 'preview';
  }
  if (['report', 'research', 'review', '调研', '报告', '复盘'].some((word) => haystack.includes(word))) {
    return 'report';
  }
  return 'document';
}

function isDeliverableKind(value: unknown): value is AssistantDeliverableCard['kind'] {
  return typeof value === 'string' && [
    'document',
    'code_change',
    'diff',
    'report',
    'link',
    'preview',
    'screenshot',
    'log',
    'pr',
    'dataset',
  ].includes(value);
}

function isDeliverableStatus(value: unknown): value is AssistantDeliverableCard['status'] {
  return typeof value === 'string' && ['ready', 'pending', 'error'].includes(value);
}

function isSupportedDeliverablePath(lowerPath: string): boolean {
  return [
    '.md',
    '.pdf',
    '.doc',
    '.docx',
    '.ppt',
    '.pptx',
    '.xls',
    '.xlsx',
    '.csv',
    '.tsv',
    '.html',
    '.htm',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.svg',
    '.log',
    '.txt',
    '.diff',
    '.patch',
  ].some((ext) => lowerPath.endsWith(ext));
}

function sortDeliverableCandidates(candidates: WorkspaceDeliverableCandidate[]): WorkspaceDeliverableCandidate[] {
  return [...candidates].sort((a, b) => {
    const left = typeof a.mtime === 'string' ? new Date(a.mtime).getTime() : 0;
    const right = typeof b.mtime === 'string' ? new Date(b.mtime).getTime() : 0;
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
  });
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
