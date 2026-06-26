import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByCredential, findUserById, getSubscription, updateUserProfile } from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import { shouldInitializeSshAtStartup } from '../startup/ssh-startup.js';
import type { Subscription, User } from '../db/client.js';

export const DEVELOPMENT_JWT_SECRET_PLACEHOLDER = 'your_jwt_secret_change_in_production';

export function requireSafeJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET || DEVELOPMENT_JWT_SECRET_PLACEHOLDER;
  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET?.trim() || secret === DEVELOPMENT_JWT_SECRET_PLACEHOLDER) {
      throw new Error('JWT_SECRET must be configured to a non-placeholder value in production');
    }
  }
  return secret;
}

const JWT_SECRET = requireSafeJwtSecret();
const JWT_EXPIRES_IN = '24h';

export const AUTH_ERROR_MESSAGES = {
  credentialRequired: '手机号或邮箱必须提供一个',
  passwordTooShort: '密码长度至少 6 位',
  accountExists: '该手机号或邮箱已注册，请直接登录或换一个账号注册',
  invalidLogin: '手机号/邮箱或密码错误',
} as const;

export class PublicAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicAuthError';
  }
}

export function isPublicAuthError(err: unknown): err is PublicAuthError {
  return err instanceof PublicAuthError;
}

function isUniqueCredentialError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; constraint?: unknown; message?: unknown };
  if (candidate.code === '23505') return true;
  if (typeof candidate.constraint === 'string' && candidate.constraint.startsWith('users_')) {
    return true;
  }
  return typeof candidate.message === 'string' && candidate.message.includes('duplicate key value');
}

function publicAuthError(message: string): PublicAuthError {
  return new PublicAuthError(message);
}

function normalizeOptionalCredential(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalEmail(value?: string): string | undefined {
  return normalizeOptionalCredential(value)?.toLowerCase();
}

export interface JWTPayload {
  userId: number;
  linuxUser: string;
  role: string;
  plan: string;
  iat: number;
  exp: number;
}

export interface PublicUser {
  id: number;
  phone?: string | null;
  email?: string | null;
  assistant_name?: string | null;
  status?: string;
  is_initialized?: boolean;
  plan: Subscription['plan'] | 'free';
  subscription?: {
    plan: Subscription['plan'];
    tokens_limit: number;
    tokens_used: number;
    tokens_remaining: number;
    reset_at: Date;
    expires_at?: Date;
  } | null;
}

function toPublicUser(
  user: Pick<User, 'id' | 'phone' | 'email' | 'assistant_name' | 'status' | 'is_initialized'>,
  subscription: Subscription | null,
  options: { includeStatus?: boolean; includeSubscription?: boolean } = {},
): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    assistant_name: user.assistant_name,
    ...(options.includeStatus ? { status: user.status } : {}),
    is_initialized: user.is_initialized,
    plan: subscription?.plan || 'free',
    ...(options.includeSubscription
      ? {
          subscription: subscription ? {
            plan: subscription.plan,
            tokens_limit: subscription.tokens_limit,
            tokens_used: subscription.tokens_used,
            tokens_remaining: subscription.tokens_limit - subscription.tokens_used,
            reset_at: subscription.reset_at,
            expires_at: subscription.expires_at,
          } : null,
        }
      : {}),
  };
}

// 注册用户
export async function register(params: {
  phone?: string;
  email?: string;
  password: string;
}): Promise<{ token: string; user: any }> {
  const phone = normalizeOptionalCredential(params.phone);
  const email = normalizeOptionalEmail(params.email);

  // 验证输入
  if (!phone && !email) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.credentialRequired);
  }

  if (params.password.length < 6) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.passwordTooShort);
  }

  // 检查用户是否已存在
  const credential = phone || email!;
  const existingUser = await findUserByCredential(credential);
  if (existingUser) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.accountExists);
  }

  // 加密密码
  const password_hash = await bcrypt.hash(params.password, 10);

  // 创建用户
  const user = await createUser({
    phone,
    email,
    password_hash,
  }).catch(err => {
    if (isUniqueCredentialError(err)) {
      throw publicAuthError(AUTH_ERROR_MESSAGES.accountExists);
    }
    throw err;
  });

  // 获取订阅信息
  const subscription = await getSubscription(user.id);

  // 生成 JWT
  const token = jwt.sign(
    {
      userId: user.id,
      linuxUser: user.linux_user,
      role: 'user',
      plan: subscription?.plan || 'free',
    } as Omit<JWTPayload, 'iat' | 'exp'>,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  if (shouldInitializeSshAtStartup()) {
    // 旧 VPS 运行时需要真实 Linux 用户；E2B 产品路径使用模板内 sandbox 用户，不创建 VPS 用户。
    vpsUserManager.createUser(user.linux_user, '用户').catch(err => {
      console.error(`❌ 异步创建 VPS 用户失败 (${user.linux_user}):`, err);
    });
  }

  return {
    token,
    user: toPublicUser(user, subscription),
  };
}

// 登录
export async function login(params: {
  credential: string; // 手机号或邮箱
  password: string;
}): Promise<{ token: string; user: any }> {
  const credential = params.credential.trim();
  const normalizedCredential = credential.includes('@')
    ? credential.toLowerCase()
    : credential;

  // 查找用户
  const user = await findUserByCredential(normalizedCredential);
  if (!user) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.invalidLogin);
  }

  // 验证密码
  const isValid = await bcrypt.compare(params.password, user.password_hash);
  if (!isValid) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.invalidLogin);
  }

  // 获取订阅信息
  const subscription = await getSubscription(user.id);

  // 生成 JWT
  const token = jwt.sign(
    {
      userId: user.id,
      linuxUser: user.linux_user,
      role: 'user',
      plan: subscription?.plan || 'free',
    } as Omit<JWTPayload, 'iat' | 'exp'>,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return {
    token,
    user: toPublicUser(user, subscription),
  };
}

// 验证 JWT
export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (err) {
    throw new Error('Token 无效或已过期');
  }
}

// 获取当前用户信息
export async function getCurrentUser(userId: number) {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('用户不存在');
  }

  const subscription = await getSubscription(userId);

  return toPublicUser(user, subscription, {
    includeStatus: true,
    includeSubscription: true,
  });
}

export async function updateCurrentUserProfile(
  userId: number,
  updates: { assistantName?: string }
) {
  const user = await updateUserProfile(userId, updates);
  if (!user) {
    throw new Error('用户不存在');
  }

  const subscription = await getSubscription(userId);

  return toPublicUser(user, subscription, {
    includeStatus: true,
    includeSubscription: true,
  });
}
