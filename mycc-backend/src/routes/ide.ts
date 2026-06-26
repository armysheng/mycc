import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy, { type ServerOptions } from 'http-proxy';
import { E2bSandboxProvider } from '../ide/e2b-provider.js';
import { ensureE2bIdeSession } from '../ide/e2b-session.js';
import { verifyToken } from '../auth/service.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import {
  resolveIdeConfig,
  type IdeConfig,
} from '../ide/service.js';
import {
  PostgresIdeSessionStore,
  type IdeSessionStore,
  type StoredIdeSession,
} from '../ide/session-store.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export type IdeRoutesOptions = {
  e2bProvider?: Pick<E2bSandboxProvider, 'startCodeServer'>
    & Partial<Pick<E2bSandboxProvider, 'isCodeServerListening' | 'isDesktopListening' | 'renewCodeServer' | 'startDesktop' | 'stopCodeServer'>>;
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
  const proxyServer = options.proxyServer ?? httpProxy.createProxyServer({ ws: true });
  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();

  fastify.get('/api/ide/config', {
    preHandler: jwtAuthMiddleware,
  }, async (_request, reply) => {
    try {
      const config = resolveIdeConfig();
      return {
        success: true,
        data: toPublicIdeConfig(config),
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

      const reusableSession = await findLiveReusableSession({
        sessionStore,
        e2bProvider,
        userId: user.userId,
      });
      if (reusableSession) {
        attachProxyCookie(reply, reusableSession, 'editor');
        return reply.status(200).send({
          success: true,
          data: toPublicSession(reusableSession),
        });
      }

      const config = resolveIdeConfig();
      if (config.provider === 'disabled') {
        throw new Error('IDE provider is disabled');
      }
      return {
        success: true,
        data: toPublicIdeConfig(config),
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

      const reusableSession = await findLiveReusableSession({
        sessionStore,
        e2bProvider,
        userId: user.userId,
      });
      if (reusableSession) {
        attachProxyCookie(reply, reusableSession, 'editor');
        return reply.status(200).send({
          success: true,
          data: toPublicSession(reusableSession),
        });
      }

      const linuxUser = sanitizeLinuxUsername(user.linuxUser);
      const session = await ensureE2bIdeSession({
        userId: user.userId,
        linuxUser,
        workspaceDir: `/home/${linuxUser}/workspace`,
        sessionStore,
        e2bProvider,
        skipReusable: true,
      });

      attachProxyCookie(reply, session, 'editor');
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

  fastify.get('/api/ide/sessions/current', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: '未提供认证 token' });
    }

    const session = await findLiveReusableSession({
      sessionStore,
      e2bProvider,
      userId: user.userId,
    });
    return {
      success: true,
      data: session ? toPublicSession(session) : null,
    };
  });

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/ide/sessions/:id/open', async (request, reply) => {
    const session = await getSessionSafely(sessionStore, request.params.id);
    if (!session) {
      return sendPublicIdeError(reply, 404, 'IDE session not found');
    }
    if (session.proxyToken !== request.query.token) {
      return sendPublicIdeError(reply, 401, 'IDE open token is invalid');
    }
    if (session.status !== 'running') {
      return sendPublicIdeError(reply, 409, 'IDE session is not running');
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

  fastify.post<{ Params: { id: string } }>('/api/ide/sessions/:id/desktop', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      const config = resolveIdeConfig();
      if (!config.desktopEnabled) {
        return sendPublicIdeError(reply, 501, 'GNU desktop is not enabled for this E2B template');
      }

      const session = await getOwnedSession(sessionStore, request.user?.userId, request.params.id);
      if (!session) {
        return sendPublicIdeError(reply, 404, 'IDE session not found');
      }
      if (session.status !== 'running') {
        return sendPublicIdeError(reply, 409, 'IDE session is not running');
      }

      const currentDesktopRunning = session.desktopPid && session.desktopHost
        ? await isDesktopServiceLive(e2bProvider, session)
        : false;
      if (currentDesktopRunning) {
        attachProxyCookie(reply, session, 'desktop');
        return {
          success: true,
          data: toPublicSession(session),
        };
      }

      if (!e2bProvider.startDesktop) {
        throw new Error('IDE provider does not support GNU desktop');
      }

      const desktop = await e2bProvider.startDesktop(session);
      const updated: StoredIdeSession = {
        ...session,
        ...desktop,
        status: 'running',
      };
      await sessionStore.set(updated);

      attachProxyCookie(reply, updated, 'desktop');
      return {
        success: true,
        data: toPublicSession(updated),
      };
    } catch (error) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/ide/sessions/:id/desktop/open', async (request, reply) => {
    const session = await getSessionSafely(sessionStore, request.params.id);
    if (!session) {
      return sendPublicIdeError(reply, 404, 'IDE session not found');
    }
    if (session.proxyToken !== request.query.token) {
      return sendPublicIdeError(reply, 401, 'Desktop open token is invalid');
    }
    if (session.status !== 'running') {
      return sendPublicIdeError(reply, 409, 'IDE session is not running');
    }
    if (!session.desktopHost || !session.desktopPort) {
      return sendPublicIdeError(reply, 409, 'GNU desktop is not running');
    }

    const maxAgeSeconds = Math.max(
      60,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    );
    reply.header('set-cookie', [
      `${proxyCookieName(session.id)}=${encodeURIComponent(session.proxyToken)}`,
      'HttpOnly',
      'SameSite=Lax',
      `Path=/api/ide/sessions/${session.id}/desktop/proxy`,
      `Max-Age=${maxAgeSeconds}`,
      ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
    ].join('; '));

    return reply.redirect(publicDesktopProxyLandingPath(session));
  });

  fastify.get<{ Params: { id: string } }>('/api/ide/sessions/:id/status', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: '未提供认证 token' });
    }

    const session = await getSessionSafely(sessionStore, request.params.id);
    if (!session || session.userId !== user.userId) {
      return sendPublicIdeError(reply, 404, 'IDE session not found');
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
        return sendPublicIdeError(reply, 404, 'IDE session not found');
      }
      if (session.status !== 'running') {
        return sendPublicIdeError(reply, 409, 'IDE session is not running');
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

      attachProxyCookie(reply, updated, 'editor');
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
        return sendPublicIdeError(reply, 404, 'IDE session not found');
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

  fastify.all<{ Params: { id: string; '*': string } }>('/api/ide/sessions/:id/desktop/proxy/*', async (request, reply) => {
    const session = await getProxySession(sessionStore, request, request.params.id);
    if (!session) {
      return sendPublicIdeError(reply, 404, 'IDE session not found');
    }
    if (session.status !== 'running') {
      return sendPublicIdeError(reply, 409, 'IDE session is not running');
    }
    if (!session.trafficAccessToken) {
      return sendPublicIdeError(reply, 502, 'IDE session is missing provider access token');
    }
    if (!session.desktopHost) {
      return sendPublicIdeError(reply, 409, 'GNU desktop is not running');
    }

    request.raw.url = buildUpstreamProxyPath(request.raw.url || '/', request.params['*']);
    reply.hijack();
    proxyServer.web(request.raw, reply.raw, {
      target: `https://${session.desktopHost}`,
      changeOrigin: true,
      headers: {
        'e2b-traffic-access-token': session.trafficAccessToken,
      },
    }, (error) => {
      sendProxyError(reply.raw, error);
    });
  });

  fastify.all<{ Params: { id: string; '*': string } }>('/api/ide/sessions/:id/proxy/*', async (request, reply) => {
    const session = await getProxySession(sessionStore, request, request.params.id);
    if (!session) {
      return sendPublicIdeError(reply, 404, 'IDE session not found');
    }
    if (session.status !== 'running') {
      return sendPublicIdeError(reply, 409, 'IDE session is not running');
    }
    if (!session.trafficAccessToken) {
      return sendPublicIdeError(reply, 502, 'IDE session is missing provider access token');
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
    socket.on?.('error', () => {
      socket.destroy();
    });
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
        target: `https://${target.host}`,
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
  const session = await getSessionSafely(sessionStore, sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}

async function getSessionSafely(
  sessionStore: IdeSessionStore,
  sessionId: string,
): Promise<StoredIdeSession | null> {
  try {
    return await sessionStore.get(sessionId);
  } catch {
    return null;
  }
}

async function findLiveReusableSession(params: {
  sessionStore: IdeSessionStore;
  e2bProvider: IdeRoutesOptions['e2bProvider'];
  userId: number;
}): Promise<StoredIdeSession | null> {
  const session = await params.sessionStore.findReusableByUser(params.userId);
  if (!session) return null;
  if (!params.e2bProvider?.isCodeServerListening) return session;

  const isListening = await isCodeServerServiceLive(params.e2bProvider, session);
  if (isListening) return session;

  await params.sessionStore.set({ ...session, status: 'stopped' });
  return null;
}

async function isCodeServerServiceLive(
  e2bProvider: IdeRoutesOptions['e2bProvider'],
  session: StoredIdeSession,
): Promise<boolean> {
  if (!e2bProvider?.isCodeServerListening) return true;
  try {
    return await e2bProvider.isCodeServerListening(session);
  } catch {
    return false;
  }
}

async function isDesktopServiceLive(
  e2bProvider: IdeRoutesOptions['e2bProvider'],
  session: StoredIdeSession,
): Promise<boolean> {
  if (!e2bProvider?.isDesktopListening) return true;
  try {
    return await e2bProvider.isDesktopListening(session);
  } catch {
    return false;
  }
}

function toPublicSession(session: StoredIdeSession) {
  return {
    id: session.id,
    status: session.status,
    expiresAt: session.expiresAt,
    openPath: publicOpenPath(session),
    ...(session.desktopPid && session.desktopPort ? {
      desktop: {
        status: 'running',
        openPath: publicDesktopOpenPath(session),
      },
    } : {}),
  };
}

function toPublicIdeConfig(config: IdeConfig) {
  const enabled = config.provider !== 'disabled';
  return {
    enabled,
    desktopEnabled: Boolean(enabled && config.desktopEnabled),
  };
}

function publicOpenPath(session: StoredIdeSession): string {
  return `/api/ide/sessions/${session.id}/proxy/`;
}

function publicDesktopOpenPath(session: StoredIdeSession): string {
  return publicDesktopProxyLandingPath(session);
}

function attachProxyCookie(
  reply: FastifyReply,
  session: StoredIdeSession,
  target: 'editor' | 'desktop',
): void {
  const path = target === 'desktop'
    ? `/api/ide/sessions/${session.id}/desktop/proxy`
    : `/api/ide/sessions/${session.id}/proxy`;
  reply.header('set-cookie', buildProxyCookie(session, path));
}

function buildProxyCookie(session: StoredIdeSession, path: string): string {
  const maxAgeSeconds = Math.max(
    60,
    Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
  );
  return [
    `${proxyCookieName(session.id)}=${encodeURIComponent(session.proxyToken)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

function publicDesktopProxyLandingPath(session: StoredIdeSession): string {
  const websocketPath = `api/ide/sessions/${session.id}/desktop/proxy/websockify`;
  const query = new URLSearchParams({
    autoconnect: 'true',
    reconnect: 'true',
    reconnect_delay: '2000',
    resize: 'scale',
    path: websocketPath,
  });
  return `/api/ide/sessions/${session.id}/desktop/proxy/vnc.html?${query.toString()}`;
}

function buildUpstreamProxyPath(rawUrl: string, wildcardPath: string | undefined): string {
  const parsed = new URL(rawUrl, 'http://mycc.local');
  const path = wildcardPath ? `/${wildcardPath}` : '/';
  return `${path}${parsed.search}`;
}

async function resolveProxyTargetFromUpgrade(
  sessionStore: IdeSessionStore,
  request: IncomingMessage,
): Promise<{ session: StoredIdeSession; upstreamPath: string; host: string } | null> {
  const parsed = new URL(request.url || '/', 'http://mycc.local');
  const matched = parsed.pathname.match(/^\/api\/ide\/sessions\/([^/]+)\/(?:(desktop)\/)?proxy\/?(.*)$/);
  const sessionId = matched?.[1];
  if (!sessionId) return null;

  const session = await getProxySessionFromHeaders(sessionStore, request.headers, sessionId);
  if (!session || session.status !== 'running' || !session.trafficAccessToken) return null;

  const isDesktop = matched?.[2] === 'desktop';
  const host = isDesktop ? session.desktopHost : session.host;
  if (!host) return null;

  const wildcardPath = matched?.[3] || '';
  const upstreamPath = `/${wildcardPath}${parsed.search}`;
  return { session, upstreamPath, host };
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
  const session = await getSessionSafely(sessionStore, sessionId);
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
  response.end(JSON.stringify({ error: '工作间暂时连接失败' }));
}

function sendRouteError(reply: FastifyReply, error: unknown, statusCode: number) {
  return sendPublicIdeError(reply, statusCode, error);
}

function sendPublicIdeError(reply: FastifyReply, statusCode: number, error: unknown) {
  return reply.status(statusCode).send({
    error: publicIdeErrorMessage(error),
  });
}

function publicIdeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const publicMessage = message
    .replace(/^IDE provider is disabled$/, '工作间当前未启用')
    .replace(/^IDE open token is invalid$/, '工作间打开凭据无效')
    .replace(/^Desktop open token is invalid$/, '桌面工作间打开凭据无效')
    .replace(/^IDE session not found$/, '工作间暂不可用')
    .replace(/^IDE session is not running$/, '工作间当前未运行')
    .replace(/^IDE session is missing provider access token$/, '工作间暂时连接失败')
    .replace(/^GNU desktop is not enabled for this E2B template$/, '桌面工作间当前未启用')
    .replace(/^GNU desktop is not running$/, '桌面工作间当前未运行')
    .replace(/\bIDE provider\b/gi, '工作间')
    .replace(/\bIDE session\b/gi, '工作间')
    .replace(/\bGNU desktop\b/gi, '桌面工作间')
    .replace(/\bE2B\b/gi, '文件空间')
    .replace(/\bcode-server\b/gi, '工作间');
  if (isInternalIdeErrorMessage(publicMessage)) {
    return '工作间暂时连接失败';
  }
  return publicMessage;
}

function isInternalIdeErrorMessage(message: string): boolean {
  return /sandbox|provider|token|secret|traffic|host=|e2b\.app|sbx_|code-server|SQLSTATE|constraint|foreign key|invalid input syntax|desktop_pid/i.test(message);
}
