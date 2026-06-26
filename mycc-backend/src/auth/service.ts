import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByCredential, findUserById, getSubscription, updateUserProfile } from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import { shouldInitializeSshAtStartup } from '../startup/ssh-startup.js';

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

export interface PublicUser {
  id: number;
  phone?: string | null;
  email?: string | null;
  assistant_name?: string | null;
  status?: string;
  is_initialized?: boolean;
  plan: string;
  subscription?: {
    plan: string;
    tokens_limit: number;
    tokens_used: number;
    tokens_remaining: number;
    reset_at: Date;
    expires_at?: Date | null;
  } | null;
}

export interface JWTPayload {
  userId: number;
  linuxUser: string;
  role: string;
  plan: string;
  iat: number;
  exp: number;
}

function toPublicUser(
  user: {
    id: number;
    phone?: string | null;
    email?: string | null;
    assistant_name?: string | null;
    status?: string;
    is_initialized?: boolean;
  },
  subscription: {
    plan: string;
    tokens_limit: number;
    tokens_used: number;
    reset_at: Date;
    expires_at?: Date | null;
  } | null | undefined,
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
}): Promise<{ token: string; user: PublicUser }> {
  // 验证输入
  if (!params.phone && !params.email) {
    throw new Error('手机号或邮箱必须提供一个');
  }

  if (params.password.length < 6) {
    throw new Error('密码长度至少 6 位');
  }

  // 检查用户是否已存在
  const credential = params.phone || params.email!;
  const existingUser = await findUserByCredential(credential);
  if (existingUser) {
    throw new Error('用户已存在');
  }

  // 加密密码
  const password_hash = await bcrypt.hash(params.password, 10);

  // 创建用户
  const user = await createUser({
    phone: params.phone,
    email: params.email,
    password_hash,
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
}): Promise<{ token: string; user: PublicUser }> {
  // 查找用户
  const user = await findUserByCredential(params.credential);
  if (!user) {
    throw new Error('用户不存在');
  }

  // 验证密码
  const isValid = await bcrypt.compare(params.password, user.password_hash);
  if (!isValid) {
    throw new Error('密码错误');
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
    throw new Error('登录凭据无效或已过期');
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
