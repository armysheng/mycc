import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'crypto';
import {
  createOAuthUserWithAccount,
  createUser,
  findUserByCredential,
  findUserById,
  findUserByOAuthAccount,
  getSubscription,
  linkOAuthAccount,
  updateUserProfile,
} from '../db/client.js';
import { vpsUserManager } from '../vps/user-manager.js';
import { shouldInitializeSshAtStartup } from '../startup/ssh-startup.js';
import type { OAuthProvider, Subscription, User } from '../db/client.js';

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
const OAUTH_STATE_EXPIRES_IN = '10m';

export const AUTH_ERROR_MESSAGES = {
  credentialRequired: '手机号或邮箱必须提供一个',
  passwordTooShort: '密码长度至少 6 位',
  accountExists: '该手机号或邮箱已注册，请直接登录或换一个账号注册',
  invalidLogin: '手机号/邮箱或密码错误',
  registrationClosed: '暂未开放自助注册，请联系团队开通账号',
  oauthEmailUnverified: '第三方账号邮箱尚未验证，请先完成邮箱验证后再登录',
  oauthProviderUnavailable: '第三方登录暂不可用，请稍后重试',
  oauthLoginFailed: '第三方登录失败，请稍后重试',
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

function publicAuthError(message: string): PublicAuthError {
  return new PublicAuthError(message);
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

function normalizeOptionalCredential(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalEmail(value?: string): string | undefined {
  return normalizeOptionalCredential(value)?.toLowerCase();
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

interface OAuthStatePayload {
  type: 'oauth_state';
  provider: OAuthProvider;
  nonce: string;
  returnTo: string;
  iat: number;
  exp: number;
}

interface OAuthProviderRuntimeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string;
  emailVerified: boolean;
}

const OAUTH_PROVIDER_NAMES = ['google', 'github'] as const;

function toPublicUser(
  user: Pick<User, 'id' | 'phone' | 'email' | 'assistant_name' | 'status' | 'is_initialized'>,
  subscription: Subscription | null | undefined,
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

function issueToken(
  user: Pick<User, 'id' | 'linux_user'>,
  subscription: Subscription | null | undefined,
): string {
  return jwt.sign(
    {
      userId: user.id,
      linuxUser: user.linux_user,
      role: 'user',
      plan: subscription?.plan || 'free',
    } as Omit<JWTPayload, 'iat' | 'exp'>,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function issueAuthResult(
  user: Pick<User, 'id' | 'phone' | 'email' | 'assistant_name' | 'status' | 'is_initialized' | 'linux_user'>,
): Promise<{ token: string; user: PublicUser }> {
  const subscription = await getSubscription(user.id);
  const token = issueToken(user, subscription);
  return {
    token,
    user: toPublicUser(user, subscription),
  };
}

function normalizeReturnTo(returnTo?: string): string {
  const value = returnTo?.trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

function normalizeFrontendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const rawBase = env.MYCC_AUTH_FRONTEND_BASE_URL?.trim();
  if (!rawBase) return '';
  return rawBase.replace(/\/$/, '');
}

function getBackendPublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.MYCC_AUTH_PUBLIC_BASE_URL?.trim() || env.MYCC_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = env.PORT?.trim() || '8080';
  return `http://localhost:${port}`;
}

function oauthEnvPrefix(provider: OAuthProvider): string {
  return provider === 'google' ? 'MYCC_OAUTH_GOOGLE' : 'MYCC_OAUTH_GITHUB';
}

function getOAuthProviderRuntimeConfig(
  provider: OAuthProvider,
  env: NodeJS.ProcessEnv = process.env,
): OAuthProviderRuntimeConfig | null {
  const prefix = oauthEnvPrefix(provider);
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${getBackendPublicBaseUrl(env)}/api/auth/oauth/${provider}/callback`,
  };
}

function allowsNewOAuthRegistration(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.MYCC_REGISTRATION_MODE?.trim().toLowerCase();
  if (mode === 'closed' || mode === 'invite') {
    return false;
  }
  if (env.MYCC_REGISTRATION_ENABLED?.trim().toLowerCase() === 'false') {
    return false;
  }
  return true;
}

export function isOAuthProvider(provider: string): provider is OAuthProvider {
  return (OAUTH_PROVIDER_NAMES as readonly string[]).includes(provider);
}

export function getOAuthPublicConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    providers: {
      google: {
        enabled: Boolean(getOAuthProviderRuntimeConfig('google', env)),
        authUrl: '/api/auth/oauth/google/start',
      },
      github: {
        enabled: Boolean(getOAuthProviderRuntimeConfig('github', env)),
        authUrl: '/api/auth/oauth/github/start',
      },
    },
  };
}

export function buildOAuthAuthorizationUrl(
  provider: OAuthProvider,
  options: { returnTo?: string } = {},
): string {
  const config = getOAuthProviderRuntimeConfig(provider);
  if (!config) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthProviderUnavailable);
  }

  const state = jwt.sign(
    {
      type: 'oauth_state',
      provider,
      nonce: randomUUID(),
      returnTo: normalizeReturnTo(options.returnTo),
    } satisfies Omit<OAuthStatePayload, 'iat' | 'exp'>,
    JWT_SECRET,
    { expiresIn: OAUTH_STATE_EXPIRES_IN },
  );

  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return url.toString();
  }

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

function verifyOAuthState(provider: OAuthProvider, state: string): OAuthStatePayload {
  const payload = jwt.verify(state, JWT_SECRET) as OAuthStatePayload;
  if (payload.type !== 'oauth_state' || payload.provider !== provider) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthLoginFailed);
  }
  return payload;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(fallbackMessage);
  }
  return response.json() as Promise<T>;
}

async function exchangeOAuthCodeForToken(
  provider: OAuthProvider,
  code: string,
): Promise<string> {
  const config = getOAuthProviderRuntimeConfig(provider);
  if (!config) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthProviderUnavailable);
  }

  const tokenUrl = provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://github.com/login/oauth/access_token';
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const tokenResponse = await readJsonResponse<{
    access_token?: string;
    error?: string;
    error_description?: string;
  }>(response, 'OAuth token exchange failed');

  if (!tokenResponse.access_token) {
    throw new Error(tokenResponse.error_description || tokenResponse.error || 'OAuth token missing');
  }
  return tokenResponse.access_token;
}

async function fetchOAuthProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthProfile> {
  if (provider === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const profile = await readJsonResponse<{
      sub?: string;
      email?: string;
      email_verified?: boolean;
    }>(response, 'Google profile fetch failed');

    if (!profile.sub) {
      throw new Error('Google profile missing subject');
    }
    return {
      provider,
      providerUserId: profile.sub,
      email: normalizeOptionalEmail(profile.email),
      emailVerified: profile.email_verified === true,
    };
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daoyou-ai',
    },
  });
  const profile = await readJsonResponse<{
    id?: number | string;
  }>(profileResponse, 'GitHub profile fetch failed');
  if (profile.id === undefined || profile.id === null) {
    throw new Error('GitHub profile missing id');
  }

  const emailsResponse = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daoyou-ai',
    },
  });
  const emails = await readJsonResponse<Array<{
    email?: string;
    primary?: boolean;
    verified?: boolean;
  }>>(emailsResponse, 'GitHub emails fetch failed');
  const verifiedEmail = emails.find((email) => email.primary && email.verified)
    || emails.find((email) => email.verified);

  return {
    provider,
    providerUserId: String(profile.id),
    email: normalizeOptionalEmail(verifiedEmail?.email),
    emailVerified: Boolean(verifiedEmail?.verified),
  };
}

export async function loginWithOAuthProfile(profile: OAuthProfile): Promise<{ token: string; user: PublicUser }> {
  const providerUserId = profile.providerUserId.trim();
  const email = normalizeOptionalEmail(profile.email);
  if (!providerUserId) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthLoginFailed);
  }

  const linkedUser = await findUserByOAuthAccount(profile.provider, providerUserId);
  if (linkedUser) {
    return issueAuthResult(linkedUser);
  }

  if (!email || !profile.emailVerified) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthEmailUnverified);
  }

  const existingUser = await findUserByCredential(email);
  if (existingUser) {
    await linkOAuthAccount({
      userId: existingUser.id,
      provider: profile.provider,
      providerUserId,
      email,
      emailVerified: true,
    });
    return issueAuthResult(existingUser);
  }

  if (!allowsNewOAuthRegistration()) {
    throw publicAuthError(AUTH_ERROR_MESSAGES.registrationClosed);
  }

  const password_hash = await bcrypt.hash(
    `oauth:${profile.provider}:${providerUserId}:${randomUUID()}:${randomBytes(16).toString('hex')}`,
    10,
  );
  const user = await createOAuthUserWithAccount({
    email,
    password_hash,
    provider: profile.provider,
    providerUserId,
    emailVerified: true,
  }).catch(err => {
    if (isUniqueCredentialError(err)) {
      throw publicAuthError(AUTH_ERROR_MESSAGES.accountExists);
    }
    throw err;
  });

  if (shouldInitializeSshAtStartup()) {
    vpsUserManager.createUser(user.linux_user, '用户').catch(err => {
      console.error(`❌ 异步创建 VPS 用户失败 (${user.linux_user}):`, err);
    });
  }

  return issueAuthResult(user);
}

export async function completeOAuthCodeLogin(
  provider: OAuthProvider,
  params: { code: string; state: string },
): Promise<{ token: string; user: PublicUser; returnTo: string }> {
  try {
    const state = verifyOAuthState(provider, params.state);
    const accessToken = await exchangeOAuthCodeForToken(provider, params.code);
    const profile = await fetchOAuthProfile(provider, accessToken);
    const result = await loginWithOAuthProfile(profile);
    return {
      ...result,
      returnTo: state.returnTo,
    };
  } catch (err) {
    if (isPublicAuthError(err)) {
      throw err;
    }
    throw publicAuthError(AUTH_ERROR_MESSAGES.oauthLoginFailed);
  }
}

export function buildOAuthFrontendRedirect(params: {
  token?: string;
  returnTo?: string;
  error?: string;
}, env: NodeJS.ProcessEnv = process.env): string {
  const base = normalizeFrontendBaseUrl(env);
  const fragment = new URLSearchParams();
  if (params.token) fragment.set('oauth_token', params.token);
  if (params.returnTo) fragment.set('return_to', normalizeReturnTo(params.returnTo));
  if (params.error) fragment.set('oauth_error', params.error);
  const path = `/login${fragment.toString() ? `#${fragment.toString()}` : ''}`;
  return base ? `${base}${path}` : path;
}

// 注册用户
export async function register(params: {
  phone?: string;
  email?: string;
  password: string;
}): Promise<{ token: string; user: PublicUser }> {
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

  if (shouldInitializeSshAtStartup()) {
    // 旧 VPS 运行时需要真实 Linux 用户；E2B 产品路径使用模板内 sandbox 用户，不创建 VPS 用户。
    vpsUserManager.createUser(user.linux_user, '用户').catch(err => {
      console.error(`❌ 异步创建 VPS 用户失败 (${user.linux_user}):`, err);
    });
  }

  return issueAuthResult(user);
}

// 登录
export async function login(params: {
  credential: string; // 手机号或邮箱
  password: string;
}): Promise<{ token: string; user: PublicUser }> {
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

  return issueAuthResult(user);
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
