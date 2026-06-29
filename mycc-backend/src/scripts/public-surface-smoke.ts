type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type RegistrationMode = 'open' | 'invite' | 'closed' | 'any';

type SmokeOptions = {
  baseUrl?: string;
  expectedRegistrationMode?: RegistrationMode;
  fetch?: FetchLike;
};

type JsonObject = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://daoyou.iaigc.fun';
const DEFAULT_EXPECTED_REGISTRATION_MODE: RegistrationMode = 'closed';
const FORBIDDEN_PUBLIC_HTML_TERMS = [
  /MyCC/i,
  /linuxUser/i,
  /\bE2B\b/i,
  /\bsandbox\b/i,
  /traffic token/i,
  /code-server/i,
  /noVNC/i,
  /mycc_u\d+/i,
  /大辉哥/,
  /老板/,
  /主人/,
];

function resolveBaseUrl(baseUrl?: string): string {
  return (
    baseUrl
    || process.env.BASE_URL
    || process.env.MYCC_PUBLIC_SURFACE_BASE_URL
    || DEFAULT_BASE_URL
  ).replace(/\/$/, '');
}

function resolveExpectedRegistrationMode(mode?: RegistrationMode): RegistrationMode {
  const raw = mode || process.env.MYCC_PUBLIC_SURFACE_REGISTRATION_MODE || DEFAULT_EXPECTED_REGISTRATION_MODE;
  if (raw === 'open' || raw === 'invite' || raw === 'closed' || raw === 'any') {
    return raw;
  }
  throw new Error(`unsupported expected registration mode: ${raw}`);
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  const candidate = fetchImpl ?? globalThis.fetch;
  if (!candidate) {
    throw new Error('global fetch is unavailable; run this smoke on Node.js 18+');
  }
  return candidate.bind(globalThis) as FetchLike;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const parts = [error.message || error.name];
    if (cause) {
      parts.push(`cause=${describeThrown(cause)}`);
    }
    return parts.join('; ');
  }
  return String(error);
}

async function get(fetchImpl: FetchLike, baseUrl: string, path: string, label: string): Promise<Response> {
  const url = `${baseUrl}${path}`;
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: {
        Connection: 'close',
      },
    });
  } catch (error) {
    throw new Error(`${label} request failed url=${url}: ${describeThrown(error)}`);
  }
}

async function readJson(response: Response, label: string): Promise<JsonObject> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    throw new Error(`${label} expected JSON response, got status=${response.status} body=${text.slice(0, 200)}`);
  }
}

async function readText(response: Response, label: string): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed status=${response.status} body=${text.slice(0, 200)}`);
  }
  return text;
}

function assertOk(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`${label} failed status=${response.status}`);
  }
}

function assertNoForbiddenPublicHtml(html: string): void {
  const matched = FORBIDDEN_PUBLIC_HTML_TERMS.find((pattern) => pattern.test(html));
  if (matched) {
    throw new Error(`public HTML leaked implementation detail matching ${String(matched)}`);
  }
}

function assertHomeBrand(html: string): void {
  if (!/<title>\s*道友 AI\s*<\/title>/i.test(html)) {
    throw new Error('home HTML title must be 道友 AI');
  }
  if (!/name=["']description["'][^>]+content=["'][^"']*道友 AI[^"']*念头通达/i.test(html)) {
    throw new Error('home HTML description must include 道友 AI and 念头通达');
  }
}

function extractAssetPaths(html: string): string[] {
  const assetPaths = Array.from(html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+\.(?:js|css))["']/gi))
    .map((match) => match[1])
    .filter((path): path is string => Boolean(path));
  return Array.from(new Set(assetPaths));
}

function normalizeAssetPath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    return `${url.pathname}${url.search}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function readRegistrationMode(body: JsonObject): unknown {
  const data = body.data;
  if (!data || typeof data !== 'object' || !('registration' in data)) return undefined;
  const registration = data.registration;
  if (!registration || typeof registration !== 'object' || !('mode' in registration)) return undefined;
  return registration.mode;
}

async function assertPublicHealth(fetchImpl: FetchLike, baseUrl: string): Promise<void> {
  const response = await get(fetchImpl, baseUrl, '/health', 'health');
  assertOk(response, 'health');
  const body = await readJson(response, 'health');
  if (body.status !== 'ok') {
    throw new Error(`health expected status=ok, got ${String(body.status)}`);
  }
}

async function assertPublicReadiness(fetchImpl: FetchLike, baseUrl: string): Promise<void> {
  const response = await get(fetchImpl, baseUrl, '/readyz', 'readyz');
  assertOk(response, 'readyz');
  const body = await readJson(response, 'readyz');
  if (body.ready !== true) {
    throw new Error(`readyz expected ready=true, got ${String(body.ready)}`);
  }
}

async function assertDeepReadinessUnauthorized(fetchImpl: FetchLike, baseUrl: string): Promise<void> {
  const response = await get(fetchImpl, baseUrl, '/readyz/deep', 'deep readiness');
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`deep readiness should be unauthorized publicly, got status=${response.status}`);
  }
  const body = await readJson(response, 'deep readiness');
  const serialized = JSON.stringify(body);
  if (/checks|runtime|database|E2B/i.test(serialized)) {
    throw new Error(`deep readiness unauthorized response exposed internal checks: ${serialized.slice(0, 240)}`);
  }
}

async function assertRegistrationConfig(
  fetchImpl: FetchLike,
  baseUrl: string,
  expectedMode: RegistrationMode,
): Promise<void> {
  const response = await get(fetchImpl, baseUrl, '/api/auth/config', 'auth config');
  assertOk(response, 'auth config');
  const body = await readJson(response, 'auth config');
  const mode = readRegistrationMode(body);
  if (expectedMode !== 'any' && mode !== expectedMode) {
    throw new Error(`registration mode expected ${expectedMode}, got ${String(mode)}`);
  }
}

async function assertHomeSurface(fetchImpl: FetchLike, baseUrl: string): Promise<string[]> {
  const response = await get(fetchImpl, baseUrl, '/', 'home HTML');
  const html = await readText(response, 'home HTML');
  assertHomeBrand(html);
  assertNoForbiddenPublicHtml(html);

  const assets = extractAssetPaths(html);
  if (!assets.some((asset) => asset.endsWith('.js'))) {
    throw new Error('home HTML did not reference a built JavaScript asset');
  }
  return assets;
}

async function assertFavicon(fetchImpl: FetchLike, baseUrl: string): Promise<void> {
  const response = await get(fetchImpl, baseUrl, '/favicon.svg', 'favicon');
  if (!response.ok) {
    throw new Error(`favicon failed status=${response.status}`);
  }
}

async function assertAssets(fetchImpl: FetchLike, baseUrl: string, assetPaths: string[]): Promise<void> {
  for (const assetPath of assetPaths) {
    const path = normalizeAssetPath(assetPath);
    const response = await get(fetchImpl, baseUrl, path, `asset ${path}`);
    if (!response.ok) {
      throw new Error(`asset ${path} failed status=${response.status}`);
    }
  }
}

export async function runPublicSurfaceSmoke(options: SmokeOptions = {}): Promise<void> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = resolveFetch(options.fetch);
  const expectedRegistrationMode = resolveExpectedRegistrationMode(options.expectedRegistrationMode);

  await assertPublicHealth(fetchImpl, baseUrl);
  await assertPublicReadiness(fetchImpl, baseUrl);
  await assertDeepReadinessUnauthorized(fetchImpl, baseUrl);
  await assertRegistrationConfig(fetchImpl, baseUrl, expectedRegistrationMode);
  const assets = await assertHomeSurface(fetchImpl, baseUrl);
  await assertFavicon(fetchImpl, baseUrl);
  await assertAssets(fetchImpl, baseUrl, assets);

  console.log('[ok] public surface smoke passed');
}
