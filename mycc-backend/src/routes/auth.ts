import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { register, login, getCurrentUser, updateCurrentUserProfile } from '../auth/service.js';
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

const publicAuthErrorMessages = new Set([
  '手机号或邮箱必须提供一个',
  '密码长度至少 6 位',
  '该手机号或邮箱已注册，请直接登录或换一个账号注册',
  '手机号/邮箱或密码错误',
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
      },
    });
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
