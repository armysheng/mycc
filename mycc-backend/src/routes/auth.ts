import { randomBytes } from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildOAuthAuthorizationUrl,
  buildOAuthFrontendRedirect,
  completeOAuthCodeLogin,
  getOAuthPublicConfig,
  getCurrentUser,
  isOAuthProvider,
  login,
  register,
  updateCurrentUserProfile,
} from '../auth/service.js';
import { buildAuthRateLimitKey, InMemoryAuthRateLimiter } from '../auth/rate-limit.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}, z.string().optional());

// 注册请求验证
const registerSchema = z.object({
  phone: optionalTrimmedString,
  email: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed ? trimmed.toLowerCase() : undefined;
  }, z.string().email().optional()),
  password: z.string().min(6),
  inviteCode: optionalTrimmedString,
}).refine(data => data.phone || data.email, {
  message: '手机号或邮箱必须提供一个',
});

// 登录请求验证
const loginSchema = z.object({
  credential: z.string().transform(value => value.trim()).pipe(z.string().min(1)), // 手机号或邮箱
  password: z.string(),
});

const oauthStartQuerySchema = z.object({
  returnTo: optionalTrimmedString,
});

const oauthCallbackQuerySchema = z.object({
  code: z.string().transform(value => value.trim()).pipe(z.string().min(1)),
  state: z.string().transform(value => value.trim()).pipe(z.string().min(1)),
});

const oauthExchangeSchema = z.object({
  code: z.string().transform(value => value.trim()).pipe(z.string().min(1)),
});

const publicAuthErrorMessages = new Set([
  '手机号或邮箱必须提供一个',
  '密码长度至少 6 位',
  '该手机号或邮箱已注册，请直接登录或换一个账号注册',
  '手机号/邮箱或密码错误',
  '暂未开放自助注册，请联系团队开通账号',
  '第三方账号邮箱尚未验证，请先完成邮箱验证后再登录',
  '第三方登录暂不可用，请稍后重试',
  '第三方登录失败，请稍后重试',
]);

function authErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && publicAuthErrorMessages.has(err.message)) {
    return err.message;
  }
  if (err instanceof Error && (err.message === '用户不存在' || err.message === '密码错误')) {
    return '手机号/邮箱或密码错误';
  }
  return fallback;
}

const authRateLimiter = new InMemoryAuthRateLimiter();
const AUTH_RATE_LIMIT_MESSAGE = '尝试次数过多，请稍后再试';
const REGISTRATION_CLOSED_MESSAGE = '暂未开放自助注册，请联系团队开通账号';
const REGISTRATION_INVITE_MESSAGE = '注册当前仅面向内测邀请开放，请填写有效邀请码';
const OAUTH_LOGIN_FAILED_MESSAGE = '第三方登录失败，请稍后重试';
const OAUTH_STATE_COOKIE_NAME = 'mycc_oauth_state';
const OAUTH_STATE_COOKIE_PATH = '/api/auth/oauth';
const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 600;
const OAUTH_LOGIN_CODE_TTL_MS = 2 * 60 * 1000;

type OAuthLoginResult = Awaited<ReturnType<typeof completeOAuthCodeLogin>>;

const oauthLoginCodes = new Map<string, {
  result: OAuthLoginResult;
  expiresAt: number;
}>();

type RegistrationMode = 'open' | 'invite' | 'closed';

function getRegistrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  const rawMode = env.MYCC_REGISTRATION_MODE?.trim().toLowerCase();
  if (rawMode === 'invite' || rawMode === 'closed' || rawMode === 'open') {
    return rawMode;
  }
  if (env.MYCC_REGISTRATION_ENABLED?.trim().toLowerCase() === 'false') {
    return 'closed';
  }
  return 'open';
}

function getRegistrationInviteCodes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.MYCC_REGISTRATION_INVITE_CODES || '')
      .split(/[\n,]/)
      .map((code) => code.trim())
      .filter(Boolean),
  );
}

function registrationConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = getRegistrationMode(env);
  return {
    mode,
    enabled: mode !== 'closed',
    inviteRequired: mode === 'invite',
  };
}

function validateRegistrationGate(inviteCode?: string, env: NodeJS.ProcessEnv = process.env) {
  const config = registrationConfig(env);
  if (config.mode === 'open') {
    return { allowed: true as const };
  }
  if (config.mode === 'closed') {
    return {
      allowed: false as const,
      statusCode: 403,
      code: 'registration_closed',
      error: REGISTRATION_CLOSED_MESSAGE,
    };
  }

  const inviteCodes = getRegistrationInviteCodes(env);
  if (inviteCodes.size === 0) {
    return {
      allowed: false as const,
      statusCode: 503,
      code: 'registration_invite_unconfigured',
      error: REGISTRATION_CLOSED_MESSAGE,
    };
  }
  if (!inviteCode || !inviteCodes.has(inviteCode)) {
    return {
      allowed: false as const,
      statusCode: 403,
      code: 'registration_invite_required',
      error: REGISTRATION_INVITE_MESSAGE,
    };
  }
  return { allowed: true as const };
}

function getClientIp(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || request.ip;
  }
  return request.ip;
}

function credentialForRateLimit(params: { phone?: string; email?: string; credential?: string }): string | undefined {
  return params.credential ?? params.phone ?? params.email;
}

function checkAuthRateLimit(
  request: FastifyRequest,
  action: 'login' | 'register',
  credential?: string,
) {
  const key = buildAuthRateLimitKey({
    action,
    ip: getClientIp(request),
    credential,
  });
  return authRateLimiter.check(key);
}

function secureCookieAttribute(): string[] {
  return process.env.NODE_ENV === 'production' ? ['Secure'] : [];
}

function buildOAuthStateCookie(state: string): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=${state}`,
    `Path=${OAUTH_STATE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${OAUTH_STATE_COOKIE_MAX_AGE_SECONDS}`,
    ...secureCookieAttribute(),
  ].join('; ');
}

function clearOAuthStateCookie(): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    `Path=${OAUTH_STATE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...secureCookieAttribute(),
  ].join('; ');
}

function parseCookies(rawCookie: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!rawCookie) return cookies;
  for (const part of rawCookie.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (!rawName || rawValueParts.length === 0) continue;
    cookies[rawName] = decodeURIComponent(rawValueParts.join('='));
  }
  return cookies;
}

function getRequestCookie(request: FastifyRequest, name: string): string | undefined {
  const rawCookie = request.headers.cookie;
  const cookieHeader = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
  return parseCookies(cookieHeader)[name];
}

function extractOAuthStateFromAuthorizationUrl(authorizationUrl: string): string {
  const state = new URL(authorizationUrl).searchParams.get('state');
  if (!state) {
    throw new Error('OAuth authorization URL missing state');
  }
  return state;
}

function createOAuthLoginCode(result: OAuthLoginResult): string {
  const now = Date.now();
  pruneExpiredOAuthLoginCodes(now);
  const code = randomBytes(32).toString('base64url');
  oauthLoginCodes.set(code, {
    result,
    expiresAt: now + OAUTH_LOGIN_CODE_TTL_MS,
  });
  return code;
}

function pruneExpiredOAuthLoginCodes(now = Date.now()): void {
  for (const [code, record] of oauthLoginCodes) {
    if (record.expiresAt <= now) {
      oauthLoginCodes.delete(code);
    }
  }
}

function consumeOAuthLoginCode(code: string): OAuthLoginResult | null {
  const record = oauthLoginCodes.get(code);
  if (!record) return null;
  oauthLoginCodes.delete(code);
  if (record.expiresAt <= Date.now()) {
    return null;
  }
  return record.result;
}

const profileUpdateSchema = z.object({
  assistantName: z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return '';
      if (typeof val !== 'string') return val;
      return val.trim();
    },
    z.string().max(50)
  ),
});

export async function authRoutes(fastify: FastifyInstance) {
  // GET /api/auth/config - 公开认证配置
  fastify.get('/api/auth/config', async (_request, reply) => {
    return reply.send({
      success: true,
      data: {
        registration: registrationConfig(),
        oauth: getOAuthPublicConfig(),
      },
    });
  });

  // GET /api/auth/oauth/:provider/start - 跳转到第三方授权页
  fastify.get('/api/auth/oauth/:provider/start', async (request, reply) => {
    const provider = (request.params as { provider?: string }).provider || '';
    if (!isOAuthProvider(provider)) {
      return reply.status(404).send({
        success: false,
        error: '第三方登录服务不存在',
      });
    }

    try {
      const query = oauthStartQuerySchema.parse(request.query);
      const authorizationUrl = buildOAuthAuthorizationUrl(provider, {
        returnTo: query.returnTo,
      });
      const state = extractOAuthStateFromAuthorizationUrl(authorizationUrl);
      reply.header('set-cookie', [buildOAuthStateCookie(state)]);
      return reply.redirect(authorizationUrl);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.issues,
        });
      }
      return reply.status(503).send({
        success: false,
        error: authErrorMessage(err, '第三方登录暂不可用，请稍后重试'),
      });
    }
  });

  // GET /api/auth/oauth/:provider/callback - 第三方授权回调
  fastify.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const provider = (request.params as { provider?: string }).provider || '';
    if (!isOAuthProvider(provider)) {
      return reply.status(404).send({
        success: false,
        error: '第三方登录服务不存在',
      });
    }

    reply.header('set-cookie', [clearOAuthStateCookie()]);
    try {
      const query = oauthCallbackQuerySchema.parse(request.query);
      const cookieState = getRequestCookie(request, OAUTH_STATE_COOKIE_NAME);
      if (cookieState !== query.state) {
        return reply.redirect(buildOAuthFrontendRedirect({
          error: OAUTH_LOGIN_FAILED_MESSAGE,
        }));
      }
      const result = await completeOAuthCodeLogin(provider, {
        code: query.code,
        state: query.state,
      });
      const loginCode = createOAuthLoginCode(result);
      return reply.redirect(buildOAuthFrontendRedirect({
        code: loginCode,
        returnTo: result.returnTo,
      }));
    } catch (err) {
      const error = err instanceof z.ZodError
        ? '请求参数错误'
        : authErrorMessage(err, '第三方登录失败，请稍后重试');
      return reply.redirect(buildOAuthFrontendRedirect({
        error,
      }));
    }
  });

  // POST /api/auth/oauth/exchange - 交换一次性 OAuth 登录 code
  fastify.post('/api/auth/oauth/exchange', async (request, reply) => {
    try {
      const body = oauthExchangeSchema.parse(request.body);
      const result = consumeOAuthLoginCode(body.code);
      if (!result) {
        return reply.status(401).send({
          success: false,
          error: '登录凭据无效或已过期',
        });
      }
      return reply.send({
        success: true,
        data: {
          token: result.token,
          user: result.user,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.issues,
        });
      }
      return reply.status(401).send({
        success: false,
        error: '登录凭据无效或已过期',
      });
    }
  });

  // POST /api/auth/register - 用户注册
  fastify.post('/api/auth/register', async (request, reply) => {
    try {
      const body = registerSchema.parse(request.body);
      const rateLimit = checkAuthRateLimit(request, 'register', credentialForRateLimit(body));
      if (!rateLimit.allowed) {
        if (rateLimit.retryAfterSeconds) {
          reply.header('Retry-After', String(rateLimit.retryAfterSeconds));
        }
        return reply.status(429).send({
          success: false,
          error: AUTH_RATE_LIMIT_MESSAGE,
        });
      }
      const gate = validateRegistrationGate(body.inviteCode);
      if (!gate.allowed) {
        return reply.status(gate.statusCode).send({
          success: false,
          code: gate.code,
          error: gate.error,
        });
      }

      const { inviteCode: _inviteCode, ...registrationParams } = body;
      const result = await register(registrationParams);

      return reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.issues,
        });
      }

      return reply.status(400).send({
        success: false,
        error: authErrorMessage(err, '注册失败，请稍后重试'),
      });
    }
  });

  // POST /api/auth/login - 用户登录
  fastify.post('/api/auth/login', async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const rateLimit = checkAuthRateLimit(request, 'login', credentialForRateLimit(body));
      if (!rateLimit.allowed) {
        if (rateLimit.retryAfterSeconds) {
          reply.header('Retry-After', String(rateLimit.retryAfterSeconds));
        }
        return reply.status(429).send({
          success: false,
          error: AUTH_RATE_LIMIT_MESSAGE,
        });
      }
      const result = await login(body);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.issues,
        });
      }

      return reply.status(401).send({
        success: false,
        error: authErrorMessage(err, '登录失败，请稍后重试'),
      });
    }
  });

  // GET /api/auth/me - 获取当前用户信息（需要认证）
  fastify.get('/api/auth/me', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          error: '未认证',
        });
      }

      const user = await getCurrentUser(request.user.userId);

      return reply.send({
        success: true,
        data: user,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : '获取用户信息失败',
      });
    }
  });

  // PUT /api/auth/profile - 更新当前用户资料（需要认证）
  fastify.put('/api/auth/profile', {
    preHandler: jwtAuthMiddleware,
  }, async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({
          success: false,
          error: '未认证',
        });
      }

      const body = profileUpdateSchema.parse(request.body);
      const user = await updateCurrentUserProfile(request.user.userId, {
        assistantName: body.assistantName,
      });

      return reply.send({
        success: true,
        data: user,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: '请求参数错误',
          details: err.issues,
        });
      }

      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : '更新资料失败',
      });
    }
  });
}
