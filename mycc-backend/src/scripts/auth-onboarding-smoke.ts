import { randomUUID } from 'node:crypto';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SmokeOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
};

type JsonObject = Record<string, unknown>;

const GENERIC_LOGIN_ERROR = '手机号/邮箱或密码错误';
const INTERNAL_DETAIL_PATTERN = /linux_user|mycc_u\d+|用户不存在/i;

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

function readToken(body: JsonObject): string {
  const data = body.data;
  if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') {
    throw new Error('registration response did not include data.token');
  }
  return data.token;
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
  const email = randomExampleEmail('auth-onboarding');
  const password = `MyccSmoke-${randomUUID()}!`;

  const registered = await postJson(fetchImpl, baseUrl, '/api/auth/register', {
    email,
    password,
  });
  if (registered.response.status !== 201 || registered.json.success !== true) {
    throw new Error(`registration failed status=${registered.response.status}`);
  }
  const token = readToken(registered.json);

  const initialized = await postJson(fetchImpl, baseUrl, '/api/onboarding/initialize', {
    assistantName: '道友',
    ownerName: '测试用户',
  }, token);
  if (!initialized.response.ok || initialized.json.success !== true) {
    throw new Error(`onboarding initialize failed status=${initialized.response.status}`);
  }

  const currentUser = await getJson(fetchImpl, baseUrl, '/api/auth/me', token);
  if (!currentUser.response.ok || currentUser.json.success !== true) {
    throw new Error(`auth me failed status=${currentUser.response.status}`);
  }

  console.log('[ok] auth onboarding smoke passed');
}
