import { randomUUID } from 'node:crypto';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SmokeOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
};

type JsonObject = Record<string, unknown>;
type OnboardingInitializeData = {
  status?: unknown;
  bootstrapPrompt?: unknown;
};
type RegistrationMode = 'open' | 'invite' | 'closed';
type ExistingTestCredentials = {
  credential: string;
  password: string;
};

const GENERIC_LOGIN_ERROR = '手机号/邮箱或密码错误';
const INTERNAL_DETAIL_PATTERN = /linux_user|mycc_u\d+|用户不存在|linuxUser/i;

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl || process.env.BASE_URL || process.env.MYCC_AUTH_SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  const candidate = fetchImpl ?? globalThis.fetch;
  if (!candidate) {
    throw new Error('global fetch is unavailable; run this smoke on Node.js 18+');
  }
  return candidate.bind(globalThis) as FetchLike;
}

function randomExampleEmail(prefix: string): string {
  return `mycc-${prefix}-${Date.now()}-${randomUUID()}@example.test`;
}

async function readJson(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new Error(`expected JSON response, got status=${response.status} body=${text.slice(0, 200)}`);
  }
}

function assertNoInternalAuthDetails(label: string, body: unknown): void {
  const serialized = JSON.stringify(body);
  if (INTERNAL_DETAIL_PATTERN.test(serialized)) {
    throw new Error(`${label} leaked internal auth detail: ${serialized.slice(0, 240)}`);
  }
}

async function postJson(fetchImpl: FetchLike, baseUrl: string, path: string, body: JsonObject, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  assertNoInternalAuthDetails(path, json);
  return { response, json };
}

async function getJson(fetchImpl: FetchLike, baseUrl: string, path: string, token: string) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const json = await readJson(response);
  assertNoInternalAuthDetails(path, json);
  return { response, json };
}

async function getPublicJson(fetchImpl: FetchLike, baseUrl: string, path: string) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'GET',
  });
  const json = await readJson(response);
  assertNoInternalAuthDetails(path, json);
  return { response, json };
}

function readToken(body: JsonObject, label: string): string {
  const data = body.data;
  if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') {
    throw new Error(`${label} did not include data.token`);
  }
  return data.token;
}

function readInitializeData(body: JsonObject): OnboardingInitializeData {
  const data = body.data;
  if (!data || typeof data !== 'object') return {};
  return data as OnboardingInitializeData;
}

function readRegistrationMode(body: JsonObject): unknown {
  const data = body.data;
  if (!data || typeof data !== 'object' || !('registration' in data)) return undefined;
  const registration = data.registration;
  if (!registration || typeof registration !== 'object' || !('mode' in registration)) return undefined;
  return registration.mode;
}

function assertRegistrationMode(mode: unknown): RegistrationMode {
  if (mode === 'open' || mode === 'invite' || mode === 'closed') {
    return mode;
  }
  throw new Error(`auth config did not include a supported registration mode, got ${String(mode)}`);
}

function readTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function resolveExistingTestCredentials(): ExistingTestCredentials | undefined {
  const credential = readTrimmedEnv('MYCC_AUTH_SMOKE_CREDENTIAL')
    ?? readTrimmedEnv('MYCC_AUTH_SMOKE_EMAIL')
    ?? readTrimmedEnv('MYCC_AUTH_SMOKE_PHONE');
  const password = process.env.MYCC_AUTH_SMOKE_PASSWORD;
  if (!credential && !password) return undefined;
  if (!credential || !password) {
    throw new Error(
      'registration is closed; set both MYCC_AUTH_SMOKE_CREDENTIAL (or MYCC_AUTH_SMOKE_EMAIL/MYCC_AUTH_SMOKE_PHONE) '
      + 'and MYCC_AUTH_SMOKE_PASSWORD for an existing test account',
    );
  }
  return { credential, password };
}

async function readTargetRegistrationMode(fetchImpl: FetchLike, baseUrl: string): Promise<RegistrationMode> {
  const config = await getPublicJson(fetchImpl, baseUrl, '/api/auth/config');
  if (!config.response.ok || config.json.success !== true) {
    throw new Error(`auth config failed status=${config.response.status}`);
  }
  return assertRegistrationMode(readRegistrationMode(config.json));
}

async function registerNewTestAccount(fetchImpl: FetchLike, baseUrl: string, registrationMode: RegistrationMode): Promise<string> {
  const email = randomExampleEmail('auth-onboarding');
  const password = `MyccSmoke-${randomUUID()}!`;
  const body: JsonObject = {
    email,
    password,
  };
  const inviteCode = readTrimmedEnv('MYCC_AUTH_SMOKE_INVITE_CODE');
  if (registrationMode === 'invite' && !inviteCode) {
    throw new Error('registration is invite-only; set MYCC_AUTH_SMOKE_INVITE_CODE before running smoke:auth-onboarding');
  }
  if (inviteCode) body.inviteCode = inviteCode;

  const registered = await postJson(fetchImpl, baseUrl, '/api/auth/register', body);
  if (registered.response.status !== 201 || registered.json.success !== true) {
    throw new Error(`registration failed status=${registered.response.status}`);
  }
  return readToken(registered.json, 'registration response');
}

async function loginExistingTestAccount(fetchImpl: FetchLike, baseUrl: string): Promise<string> {
  const credentials = resolveExistingTestCredentials();
  if (!credentials) {
    throw new Error(
      'registration is closed; set MYCC_AUTH_SMOKE_CREDENTIAL (or MYCC_AUTH_SMOKE_EMAIL/MYCC_AUTH_SMOKE_PHONE) '
      + 'and MYCC_AUTH_SMOKE_PASSWORD for an existing test account before running smoke:auth-onboarding',
    );
  }

  const loggedIn = await postJson(fetchImpl, baseUrl, '/api/auth/login', {
    credential: credentials.credential,
    password: credentials.password,
  });
  if (!loggedIn.response.ok || loggedIn.json.success !== true) {
    throw new Error(`closed-mode login failed status=${loggedIn.response.status}`);
  }
  return readToken(loggedIn.json, 'login response');
}

export async function runAuthPrivacySmoke(options: SmokeOptions = {}): Promise<void> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = resolveFetch(options.fetch);
  const credential = randomExampleEmail('auth-privacy');
  const password = `Wrong-${randomUUID()}`;

  const { response, json } = await postJson(fetchImpl, baseUrl, '/api/auth/login', {
    credential,
    password,
  });

  if (response.status !== 401) {
    throw new Error(`expected login status 401, got ${response.status}`);
  }
  if (json.error !== GENERIC_LOGIN_ERROR) {
    throw new Error(`expected generic login error "${GENERIC_LOGIN_ERROR}", got ${String(json.error)}`);
  }

  console.log('[ok] auth privacy smoke passed');
}

export async function runAuthOnboardingSmoke(options: SmokeOptions = {}): Promise<void> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = resolveFetch(options.fetch);
  const registrationMode = await readTargetRegistrationMode(fetchImpl, baseUrl);
  const token = registrationMode === 'closed'
    ? await loginExistingTestAccount(fetchImpl, baseUrl)
    : await registerNewTestAccount(fetchImpl, baseUrl, registrationMode);

  const initialized = await postJson(fetchImpl, baseUrl, '/api/onboarding/initialize', {
    assistantName: '道友',
    ownerName: '测试用户',
  }, token);
  if (!initialized.response.ok || initialized.json.success !== true) {
    throw new Error(`onboarding initialize failed status=${initialized.response.status}`);
  }
  const initializedData = readInitializeData(initialized.json);
  if (initializedData.status !== 'ready') {
    throw new Error('onboarding initialize response did not report ready status');
  }
  if (initializedData.bootstrapPrompt !== undefined) {
    throw new Error('onboarding initialize response exposed a bootstrap prompt');
  }

  const currentUser = await getJson(fetchImpl, baseUrl, '/api/auth/me', token);
  if (!currentUser.response.ok || currentUser.json.success !== true) {
    throw new Error(`auth me failed status=${currentUser.response.status}`);
  }

  console.log('[ok] auth onboarding smoke passed');
}
