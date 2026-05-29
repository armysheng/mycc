import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createProxyServer, type ServerOptions } from 'http-proxy';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { verifyToken } from '../auth/service.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  buildE2bCodeServerSessionPlan,
  resolveIdeConfig,
} from '../ide/service.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
  type StoredIdeSession,
} from '../ide/session-store.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export type IdeRoutesOptions = {
  e2bProvider?: Pick<E2bSandboxProvider, 'startCodeServer'>
    & Partial<Pick<E2bSandboxProvider, 'renewCodeServer' | 'stopCodeServer'>>;
  proxyServer?: IdeProxyServer;
  sessionStore?: IdeSessionStore;
};

type IdeProxyServer = {
  web(
    req: IncomingMessage,
    res: ServerResponse,
    options: ServerOptions,
    callback: (error: Error) => void,
  ): void;
  ws?(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options: ServerOptions,
    callback: (error: Error) => void,
  ): void;
};

export async function ideRoutes(fastify: FastifyInstance, options: IdeRoutesOptions = {}) {
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const proxyServer = options.proxyServer ?? createProxyServer({ ws: true });
  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();

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
        proxyToken: randomUUID(),
        userId: user.userId,
        status: 'running',
      };
      await sessionStore.set(session);

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

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/ide/sessions/:id/open', async (request, reply) => {
    const session = await sessionStore.get(request.params.id);
    if (!session || session.proxyToken !== request.query.token) {
      return reply.status(401).send({ error: 'IDE open token is invalid' });
    }
    if (session.status !== 'running') {
      return reply.status(409).send({ error: 'IDE session is not running' });
    }

    const maxAgeSeconds = Math.max(
      60,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    );
    reply.header('set-cookie', [
      `${proxyCookieName(session.id)}=${encodeURIComponent(session.proxyToken)}`,
      'HttpOnly',
      'SameSite=Lax',
      `Path=/api/ide/sessions/${session.id}/proxy`,
      `Max-Age=${maxAgeSeconds}`,
      ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
    ].join('; '));

    return reply.redirect(`/api/ide/sessions/${session.id}/proxy/`);
  });

  fastify.get<{ Params: { id: string } }>('/api/ide/sessions/:id/status', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: '未提供认证 token' });
    }

    const session = await sessionStore.get(request.params.id);
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
      const session = await getOwnedSession(sessionStore, request.user?.userId, request.params.id);
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
      await sessionStore.set(updated);

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
      const session = await getOwnedSession(sessionStore, request.user?.userId, request.params.id);
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
      await sessionStore.set(stopped);

      return {
        success: true,
        data: toPublicSession(stopped),
      };
    } catch (error) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.all<{ Params: { id: string; '*': string } }>('/api/ide/sessions/:id/proxy/*', async (request, reply) => {
    const session = await getProxySession(sessionStore, request, request.params.id);
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

  fastify.server.on('upgrade', async (request, socket, head) => {
    try {
      const target = await resolveProxyTargetFromUpgrade(sessionStore, request);
      if (!target || !proxyServer.ws) {
        socket.destroy();
        return;
      }

      request.url = target.upstreamPath;
      const trafficAccessToken = target.session.trafficAccessToken;
      if (!trafficAccessToken) {
        socket.destroy();
        return;
      }
      proxyServer.ws(request, socket, head, {
        target: `https://${target.session.host}`,
        changeOrigin: true,
        headers: {
          'e2b-traffic-access-token': trafficAccessToken,
        },
      }, () => {
        socket.destroy();
      });
    } catch {
      socket.destroy();
    }
  });
}

async function getOwnedSession(
  sessionStore: IdeSessionStore,
  userId: number | undefined,
  sessionId: string,
): Promise<StoredIdeSession | null> {
  if (!userId) return null;
  const session = await sessionStore.get(sessionId);
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
    openPath: publicOpenPath(session),
  };
}

function publicOpenPath(session: StoredIdeSession): string {
  return `/api/ide/sessions/${session.id}/open?token=${encodeURIComponent(session.proxyToken)}`;
}

function buildUpstreamProxyPath(rawUrl: string, wildcardPath: string | undefined): string {
  const parsed = new URL(rawUrl, 'http://mycc.local');
  const path = wildcardPath ? `/${wildcardPath}` : '/';
  return `${path}${parsed.search}`;
}

async function resolveProxyTargetFromUpgrade(
  sessionStore: IdeSessionStore,
  request: IncomingMessage,
): Promise<{ session: StoredIdeSession; upstreamPath: string } | null> {
  const parsed = new URL(request.url || '/', 'http://mycc.local');
  const matched = parsed.pathname.match(/^\/api\/ide\/sessions\/([^/]+)\/proxy\/?(.*)$/);
  const sessionId = matched?.[1];
  if (!sessionId) return null;

  const session = await getProxySessionFromHeaders(sessionStore, request.headers, sessionId);
  if (!session || session.status !== 'running' || !session.trafficAccessToken) return null;

  const wildcardPath = matched?.[2] || '';
  const upstreamPath = `/${wildcardPath}${parsed.search}`;
  return { session, upstreamPath };
}

function getProxySession(
  sessionStore: IdeSessionStore,
  request: FastifyRequest,
  sessionId: string,
): Promise<StoredIdeSession | null> {
  return getProxySessionFromHeaders(sessionStore, request.headers, sessionId);
}

async function getProxySessionFromHeaders(
  sessionStore: IdeSessionStore,
  headers: FastifyRequest['headers'] | IncomingMessage['headers'],
  sessionId: string,
): Promise<StoredIdeSession | null> {
  const session = await sessionStore.get(sessionId);
  if (!session) return null;

  const userId = userIdFromAuthorization(headerValue(headers.authorization));
  if (userId && userId === session.userId) {
    return session;
  }

  const cookieToken = parseCookies(headerValue(headers.cookie) || '')[proxyCookieName(sessionId)];
  if (cookieToken && cookieToken === session.proxyToken) {
    return session;
  }

  return null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function userIdFromAuthorization(authorization: string | undefined): number | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    return verifyToken(authorization.slice('Bearer '.length)).userId;
  } catch {
    return null;
  }
}

function proxyCookieName(sessionId: string): string {
  return `mycc_ide_${sessionId}`;
}

function parseCookies(rawCookie: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of rawCookie.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (!rawName || rawValueParts.length === 0) continue;
    cookies[rawName] = decodeURIComponent(rawValueParts.join('='));
  }
  return cookies;
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
