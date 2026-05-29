import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { E2bSandboxProvider, type StartedCodeServerSession } from '../ide/e2b-provider.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  buildE2bCodeServerSessionPlan,
  resolveIdeConfig,
} from '../ide/service.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export type IdeSessionStatus = 'running';

export type StoredIdeSession = StartedCodeServerSession & {
  id: string;
  userId: number;
  status: IdeSessionStatus;
};

export type IdeRoutesOptions = {
  e2bProvider?: Pick<E2bSandboxProvider, 'startCodeServer'>;
  sessionStore?: Map<string, StoredIdeSession>;
};

export async function ideRoutes(fastify: FastifyInstance, options: IdeRoutesOptions = {}) {
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const sessionStore = options.sessionStore ?? new Map<string, StoredIdeSession>();

  fastify.get('/api/ide/config', {
    preHandler: jwtAuthMiddleware,
  }, async (_request, reply) => {
    try {
      const config = resolveIdeConfig();
      return {
        success: true,
        data: {
          provider: config.provider,
          enabled: config.provider !== 'disabled',
          codeServerPort: config.codeServerPort,
          sessionTtlSeconds: config.sessionTtlSeconds,
          accessMode: 'mycc-proxy',
          ...(config.e2bTemplate ? { e2bTemplate: config.e2bTemplate } : {}),
        },
      };
    } catch (error) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.post('/api/ide/sessions/plan', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: '未提供认证 token' });
      }

      const linuxUser = sanitizeLinuxUsername(user.linuxUser);
      const plan = buildE2bCodeServerSessionPlan({
        userId: user.userId,
        linuxUser,
        workspaceDir: `/home/${linuxUser}/workspace`,
      });

      const { startCommand: _startCommand, ...publicPlan } = plan;
      return {
        success: true,
        data: publicPlan,
      };
    } catch (error) {
      const statusCode = error instanceof Error && error.message === 'IDE provider is disabled'
        ? 501
        : 400;
      return sendRouteError(reply, error, statusCode);
    }
  });

  fastify.post('/api/ide/sessions', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: '未提供认证 token' });
      }

      const linuxUser = sanitizeLinuxUsername(user.linuxUser);
      const plan = buildE2bCodeServerSessionPlan({
        userId: user.userId,
        linuxUser,
        workspaceDir: `/home/${linuxUser}/workspace`,
      });
      const started = await e2bProvider.startCodeServer(plan);
      const session: StoredIdeSession = {
        ...started,
        id: randomUUID(),
        userId: user.userId,
        status: 'running',
      };
      sessionStore.set(session.id, session);

      return reply.status(201).send({
        success: true,
        data: toPublicSession(session),
      });
    } catch (error) {
      const statusCode = error instanceof Error && error.message === 'IDE provider is disabled'
        ? 501
        : 400;
      return sendRouteError(reply, error, statusCode);
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/ide/sessions/:id/status', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: '未提供认证 token' });
    }

    const session = sessionStore.get(request.params.id);
    if (!session || session.userId !== user.userId) {
      return reply.status(404).send({ error: 'IDE session not found' });
    }

    return {
      success: true,
      data: toPublicSession(session),
    };
  });
}

function toPublicSession(session: StoredIdeSession) {
  return {
    id: session.id,
    provider: session.provider,
    sandboxId: session.sandboxId,
    codeServerPid: session.codeServerPid,
    port: session.port,
    accessMode: session.accessMode,
    status: session.status,
    expiresAt: session.expiresAt,
    openPath: `/api/ide/sessions/${session.id}/proxy/`,
  };
}

function sendRouteError(reply: FastifyReply, error: unknown, statusCode: number) {
  return reply.status(statusCode).send({
    error: error instanceof Error ? error.message : String(error),
  });
}
