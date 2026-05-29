import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createProxyServer, type ServerOptions } from 'http-proxy';
import { E2bSandboxProvider, type StartedCodeServerSession } from '../ide/e2b-provider.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  buildE2bCodeServerSessionPlan,
  resolveIdeConfig,
} from '../ide/service.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export type IdeSessionStatus = 'running' | 'stopped';

export type StoredIdeSession = StartedCodeServerSession & {
  id: string;
  userId: number;
  status: IdeSessionStatus;
};

export type IdeRoutesOptions = {
  e2bProvider?: Pick<E2bSandboxProvider, 'startCodeServer'>
    & Partial<Pick<E2bSandboxProvider, 'renewCodeServer' | 'stopCodeServer'>>;
  proxyServer?: IdeProxyServer;
  sessionStore?: Map<string, StoredIdeSession>;
};

type IdeProxyServer = {
  web(
    req: IncomingMessage,
    res: ServerResponse,
    options: ServerOptions,
    callback: (error: Error) => void,
  ): void;
};

export async function ideRoutes(fastify: FastifyInstance, options: IdeRoutesOptions = {}) {
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const proxyServer = options.proxyServer ?? createProxyServer({ ws: true });
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

  fastify.post<{ Params: { id: string } }>('/api/ide/sessions/:id/renew', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      const session = getOwnedSession(sessionStore, request.user?.userId, request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'IDE session not found' });
      }
      if (session.status !== 'running') {
        return reply.status(409).send({ error: 'IDE session is not running' });
      }
      if (!e2bProvider.renewCodeServer) {
        throw new Error('IDE provider does not support renew');
      }

      const config = resolveIdeConfig();
      const renewed = await e2bProvider.renewCodeServer(session, config.sessionTtlSeconds);
      const updated: StoredIdeSession = {
        ...session,
        ...renewed,
        status: 'running',
      };
      sessionStore.set(session.id, updated);

      return {
        success: true,
        data: toPublicSession(updated),
      };
    } catch (error) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/ide/sessions/:id', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      const session = getOwnedSession(sessionStore, request.user?.userId, request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'IDE session not found' });
      }

      if (session.status === 'running') {
        if (!e2bProvider.stopCodeServer) {
          throw new Error('IDE provider does not support stop');
        }
        await e2bProvider.stopCodeServer(session);
      }

      const stopped: StoredIdeSession = {
        ...session,
        status: 'stopped',
      };
      sessionStore.set(session.id, stopped);

      return {
        success: true,
        data: toPublicSession(stopped),
      };
    } catch (error) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.all<{ Params: { id: string; '*': string } }>('/api/ide/sessions/:id/proxy/*', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    const session = getOwnedSession(sessionStore, request.user?.userId, request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'IDE session not found' });
    }
    if (session.status !== 'running') {
      return reply.status(409).send({ error: 'IDE session is not running' });
    }
    if (!session.trafficAccessToken) {
      return reply.status(502).send({ error: 'IDE session is missing provider access token' });
    }

    request.raw.url = buildUpstreamProxyPath(request.raw.url || '/', request.params['*']);
    reply.hijack();
    proxyServer.web(request.raw, reply.raw, {
      target: `https://${session.host}`,
      changeOrigin: true,
      headers: {
        'e2b-traffic-access-token': session.trafficAccessToken,
      },
    }, (error) => {
      sendProxyError(reply.raw, error);
    });
  });
}

function getOwnedSession(
  sessionStore: Map<string, StoredIdeSession>,
  userId: number | undefined,
  sessionId: string,
): StoredIdeSession | null {
  if (!userId) return null;
  const session = sessionStore.get(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
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

function buildUpstreamProxyPath(rawUrl: string, wildcardPath: string | undefined): string {
  const parsed = new URL(rawUrl, 'http://mycc.local');
  const path = wildcardPath ? `/${wildcardPath}` : '/';
  return `${path}${parsed.search}`;
}

function sendProxyError(response: ServerResponse, error: Error): void {
  if (response.headersSent) {
    response.destroy(error);
    return;
  }

  response.statusCode = 502;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: 'IDE proxy failed' }));
}

function sendRouteError(reply: FastifyReply, error: unknown, statusCode: number) {
  return reply.status(statusCode).send({
    error: error instanceof Error ? error.message : String(error),
  });
}
