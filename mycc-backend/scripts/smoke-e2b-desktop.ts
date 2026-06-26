import dotenv from 'dotenv';
import { Template } from 'e2b';
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/client.js';
import { requireE2bApiKey } from '../src/ide/e2b-api-key.js';
import { E2bSandboxProvider } from '../src/ide/e2b-provider.js';
import { PostgresIdeSessionStore, type StoredIdeSession } from '../src/ide/session-store.js';

dotenv.config();

type IdeConfigResponse = {
  success: true;
  data: {
    enabled: boolean;
    desktopEnabled?: boolean;
  };
};

type IdeSessionResponse = {
  success: true;
  data: {
    id: string;
    openPath: string;
    status: string;
    host?: string;
    trafficAccessToken?: string;
    desktopHost?: string;
    desktop?: {
      status?: string;
      port?: number;
      openPath?: string;
      host?: string;
      trafficAccessToken?: string;
    };
  };
};

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';
const FALLBACK_TEMPLATE_NAME = process.env.MYCC_E2B_TEMPLATE || 'mycc-assistant-sandbox-dev';
const TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_TIMEOUT_MS, 120_000);
const API_REQUEST_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_API_REQUEST_TIMEOUT_MS, 60_000);
const PROXY_REQUEST_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_PROXY_REQUEST_TIMEOUT_MS, 15_000);
const DIRECT_HOST_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_DIRECT_HOST_TIMEOUT_MS, 15_000);
const USER_ID = parsePositiveInteger(process.env.MYCC_SMOKE_USER_ID, 42);
const LINUX_USER = process.env.MYCC_SMOKE_LINUX_USER || 'mycc';
const DB_LINUX_USER = process.env.MYCC_SMOKE_DB_LINUX_USER || `mycc_smoke_${USER_ID}`;

let sessionId: string | undefined;
const sessionStore = new PostgresIdeSessionStore();
const e2bProvider = new E2bSandboxProvider();

async function main() {
  const apiKey = requireE2bApiKey();
  process.env.MYCC_E2B_API_KEY = apiKey;
  await ensureSmokeUser();

  const token = jwt.sign({
    userId: USER_ID,
    linuxUser: LINUX_USER,
    role: 'user',
    plan: 'free',
  }, JWT_SECRET, { expiresIn: '15m' });
  const authorization = `Bearer ${token}`;

  try {
    const config = await requestJson<IdeConfigResponse>('/api/ide/config', {
      headers: { authorization },
    });
    if (!config.data.enabled) {
      throw new Error(`IDE is not enabled: ${JSON.stringify(config.data)}`);
    }
    if (!config.data.desktopEnabled) {
      throw new Error(`GNU desktop is not enabled by MyCC backend config: ${JSON.stringify(config.data)}`);
    }
    const templateName = FALLBACK_TEMPLATE_NAME;
    const templateExists = await Template.exists(templateName, { apiKey });
    if (!templateExists) {
      throw new Error(`E2B template does not exist: ${templateName}`);
    }

    const created = await requestJson<IdeSessionResponse>('/api/ide/sessions', {
      method: 'POST',
      headers: { authorization },
    });
    sessionId = created.data.id;
    assertNoProviderSecrets(created.data);

    const desktop = await requestJsonWithHeaders<IdeSessionResponse>(`/api/ide/sessions/${sessionId}/desktop`, {
      method: 'POST',
      headers: { authorization },
    });
    assertNoProviderSecrets(desktop.body.data);
    if (desktop.body.data.desktop?.status !== 'running' || !desktop.body.data.desktop.openPath) {
      throw new Error(`GNU desktop did not start: ${JSON.stringify(desktop.body.data)}`);
    }

    const privateSession = await getPrivateDesktopSession(sessionId);
    await assertDirectDesktopHostRejectsUnauthenticatedTraffic(privateSession);

    const cookie = extractProxyCookie(desktop.headers);
    const location = desktop.body.data.desktop.openPath;

    await waitForNoVncProxy(location, cookie);
    console.log(`[ok] E2B desktop smoke passed: session=${sessionId}, template=${templateName}`);
  } finally {
    try {
      if (sessionId) {
        await cleanupSession(sessionId, authorization);
      }
    } finally {
      await pool.end();
    }
  }
}

async function requestJson<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const { body } = await requestJsonWithHeaders<T>(pathOrUrl, init);
  return body;
}

async function requestJsonWithHeaders<T>(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<{ body: T; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(resolveUrl(pathOrUrl), {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`${init.method || 'GET'} ${pathOrUrl} timed out after ${API_REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${pathOrUrl} failed: ${response.status} ${body}`);
  }
  return {
    body: JSON.parse(body) as T,
    headers: response.headers,
  };
}

async function waitForNoVncProxy(location: string, cookie: string): Promise<void> {
  const startedAt = Date.now();
  let lastStatus = 0;
  let lastBody = '';

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const response = await fetch(resolveUrl(location), {
      headers: { cookie },
      signal: AbortSignal.timeout(PROXY_REQUEST_TIMEOUT_MS),
    });
    lastStatus = response.status;
    lastBody = await response.text().catch(() => '');
    if (response.ok && /noVNC|novnc|websockify|vnc/i.test(lastBody)) {
      assertNoProviderSecretsInText(lastBody);
      return;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for proxied noVNC page: status=${lastStatus} body=${lastBody.slice(0, 240)}`);
}

async function getPrivateDesktopSession(id: string): Promise<StoredIdeSession> {
  const session = await sessionStore.get(id);
  if (!session) {
    throw new Error(`IDE session was not persisted: ${id}`);
  }
  if (!session.desktopHost || !session.trafficAccessToken) {
    throw new Error('IDE session is missing private desktop provider routing data');
  }
  return session;
}

async function assertDirectDesktopHostRejectsUnauthenticatedTraffic(session: StoredIdeSession): Promise<void> {
  const response = await fetch(`https://${session.desktopHost}/vnc.html`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(DIRECT_HOST_TIMEOUT_MS),
  });
  if (response.ok) {
    throw new Error('Direct E2B desktop host accepted unauthenticated traffic; expected MyCC proxy-only access');
  }
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`Direct E2B desktop host returned unexpected unauthenticated status: ${response.status}`);
  }
}

async function cleanupSession(id: string, authorization: string): Promise<void> {
  const stopped = await requestJson<IdeSessionResponse>(`/api/ide/sessions/${id}`, {
    method: 'DELETE',
    headers: { authorization },
  });
  if (stopped.data.status !== 'stopped') {
    throw new Error(`Cleanup did not stop IDE session ${id}: ${JSON.stringify(stopped.data)}`);
  }
  console.log(`[cleanup] E2B desktop smoke cleanup complete: session=${id}`);
}

async function ensureSmokeUser(): Promise<void> {
  await pool.query(
    `INSERT INTO users (
       id,
       phone,
       email,
       password_hash,
       nickname,
       assistant_name,
       linux_user,
       status,
       is_initialized
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', true)
     ON CONFLICT (id)
     DO UPDATE SET linux_user = EXCLUDED.linux_user,
                   status = 'active',
                   is_initialized = true,
                   updated_at = NOW()`,
    [
      USER_ID,
      `smoke-${USER_ID}`,
      `smoke-${USER_ID}@mycc.local`,
      'smoke-password-hash',
      'Smoke Test',
      'cc',
      DB_LINUX_USER,
    ],
  );
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1), true)`,
  );
}

function assertNoProviderSecrets(session: IdeSessionResponse['data']): void {
  if (session.host || session.trafficAccessToken || session.desktopHost || session.desktop?.host || session.desktop?.trafficAccessToken) {
    throw new Error('IDE desktop response leaked provider routing fields');
  }
  assertNoProviderSecretsInText(JSON.stringify(session));
}

function assertNoProviderSecretsInText(text: string): void {
  if (/\be2b-traffic-access-token\b/i.test(text) || /\btrafficAccessToken\b/.test(text)) {
    throw new Error('Response leaked E2B traffic token metadata');
  }
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|e2b_[A-Za-z0-9_-]{16,}|claude_[A-Za-z0-9_-]{20,}|anthropic_[A-Za-z0-9_-]{20,})\b/.test(text)) {
    throw new Error('Response leaked a secret-shaped token');
  }
  if (/\b[0-9]{2,5}-sbx_[A-Za-z0-9_-]+\.e2b\.app\b/i.test(text)) {
    throw new Error('Response leaked a raw E2B host');
  }
}

function extractProxyCookie(headers: Headers): string {
  const cookies = getSetCookie(headers);
  const proxyCookie = cookies.find((cookie) => cookie.includes('mycc_ide_'));
  if (!proxyCookie || !proxyCookie.includes('HttpOnly')) {
    throw new Error(`Missing HttpOnly IDE proxy cookie: ${cookies.join(', ')}`);
  }
  if (!proxyCookie.includes('/desktop/proxy')) {
    throw new Error(`Desktop proxy cookie is not scoped to the desktop proxy path: ${proxyCookie}`);
  }
  return proxyCookie.split(';')[0] || proxyCookie;
}

function getSetCookie(headers: Headers): string[] {
  const maybeGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const cookies = maybeGetSetCookie.getSetCookie?.();
  if (cookies?.length) {
    return cookies;
  }
  const cookie = headers.get('set-cookie');
  return cookie ? [cookie] : [];
}

function resolveUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `${BASE_URL}/${pathOrUrl.replace(/^\/+/, '')}`;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${raw}`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[error] E2B desktop smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
