import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, JWTPayload } from '../auth/service.js';
import { findUserById } from '../db/client.js';
import type { User } from '../db/client.js';

// 扩展 FastifyRequest 类型
declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

function parseCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAdminUser(
  user: Pick<User, 'id' | 'email' | 'phone'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const adminIds = new Set(parseCsv(env.MYCC_ADMIN_USER_IDS));
  if (adminIds.has(String(user.id))) return true;

  const adminEmails = new Set(parseCsv(env.MYCC_ADMIN_EMAILS).map((email) => email.toLowerCase()));
  if (user.email && adminEmails.has(user.email.toLowerCase())) return true;

  const adminPhones = new Set(parseCsv(env.MYCC_ADMIN_PHONES));
  return Boolean(user.phone && adminPhones.has(user.phone));
}

function buildAuthenticatedPayload(payload: JWTPayload, user: User): JWTPayload {
  return {
    ...payload,
    linuxUser: user.linux_user,
    role: isAdminUser(user) ? 'admin' : 'user',
  };
}

// JWT 认证中间件
export async function jwtAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // 从 Authorization header 获取 token
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: '未提供认证 token' });
    }

    const token = authHeader.substring(7); // 移除 "Bearer " 前缀

    // 验证 token
    const payload = verifyToken(token);
    const user = await findUserById(payload.userId);
    if (!user || user.status !== 'active') {
      return reply.status(401).send({ error: '账号不可用，请重新登录' });
    }

    // 权限和运行时身份以当前用户记录为准，避免信任旧 token 中的权限字段。
    request.user = buildAuthenticatedPayload(payload, user);
  } catch (err) {
    return reply.status(401).send({
      error: 'Token 无效或已过期',
      message: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}

// 可选的 JWT 认证（不强制要求）
export async function optionalJwtAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      const user = await findUserById(payload.userId);
      if (user && user.status === 'active') {
        request.user = buildAuthenticatedPayload(payload, user);
      }
    }
  } catch (err) {
    // 忽略错误，继续处理请求
  }
}
