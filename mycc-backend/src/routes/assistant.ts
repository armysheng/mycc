import type { FastifyInstance } from 'fastify';
import { findUserById as defaultFindUserById, getUserConversations as defaultGetUserConversations } from '../db/client.js';
import type { ConversationSummary, User } from '../db/client.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
  type StoredIdeSession,
} from '../ide/session-store.js';

export type AssistantTaskStatus = 'recent' | 'active' | 'waiting' | 'needs_workspace';

export type AssistantRoutesOptions = {
  getUserConversations?: (
    userId: number,
    limit?: number,
    offset?: number,
  ) => Promise<ConversationSummary[]>;
  findUserById?: (userId: number) => Promise<User | null>;
  sessionStore?: IdeSessionStore;
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

export async function assistantRoutes(
  fastify: FastifyInstance,
  options: AssistantRoutesOptions = {},
) {
  const getUserConversations = options.getUserConversations ?? defaultGetUserConversations;
  const findUserById = options.findUserById ?? defaultFindUserById;
  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();

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

    return {
      success: true,
      data: {
        assistant: {
          name: user?.assistant_name?.trim() || 'cc',
          initialized: Boolean(user?.is_initialized),
        },
        tasks: conversations.map(toTaskCard),
        deliverables: [],
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

    return {
      success: true,
      data: {
        deliverables: [],
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

function deliverableEmptyState(): AssistantDeliverableEmptyState {
  return {
    title: '还没有制品',
    description: '助理产出的报告、文件、预览、PR 和日志会在这里出现。',
  };
}
