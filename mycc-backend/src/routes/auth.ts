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

function getClientIp(request: { ip: string; headers: Record<string, unknown> }): string {
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
      const result = await register(body);

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
