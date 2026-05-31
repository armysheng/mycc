import dotenv from 'dotenv';
import { Template } from 'e2b';
import jwt from 'jsonwebtoken';
import { requireE2bApiKey } from '../src/ide/e2b-api-key.js';
import { DEFAULT_E2B_AGENT_TEMPLATE_NAME } from '../src/ide/e2b-preflight.js';
import { PostgresIdeSessionStore, type StoredIdeSession } from '../src/ide/session-store.js';
import { pool } from '../src/db/client.js';

dotenv.config();

type IdeConfigResponse = {
  success: true;
  data: {
    enabled: boolean;
    provider: string;
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
  };
};

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';
const TEMPLATE_NAME = process.env.MYCC_E2B_TEMPLATE || DEFAULT_E2B_AGENT_TEMPLATE_NAME;
const TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_TIMEOUT_MS, 120_000);
const DIRECT_HOST_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_DIRECT_HOST_TIMEOUT_MS, 15_000);
const USER_ID = parsePositiveInteger(process.env.MYCC_SMOKE_USER_ID, 42);
const LINUX_USER = process.env.MYCC_SMOKE_LINUX_USER || 'mycc';

let sessionId: string | undefined;
const sessionStore = new PostgresIdeSessionStore();

async function main() {
  const apiKey = requireE2bApiKey();
  process.env.MYCC_E2B_API_KEY = apiKey;
  const templateExists = await Template.exists(TEMPLATE_NAME, { apiKey });
  if (!templateExists) {
    throw new Error(`E2B template does not exist: ${TEMPLATE_NAME}`);
  }

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
    if (!config.data.enabled || config.data.provider !== 'e2b') {
      throw new Error(`IDE is not enabled for E2B: ${JSON.stringify(config.data)}`);
    }

    const created = await requestJson<IdeSessionResponse>('/api/ide/sessions', {
      method: 'POST',
      headers: { authorization },
    });
    sessionId = created.data.id;
    assertNoProviderSecrets(created.data);

    const privateSession = await getPrivateSession(sessionId);
    await assertDirectHostRejectsUnauthenticatedTraffic(privateSession);

    const open = await fetch(resolveUrl(created.data.openPath), {
      redirect: 'manual',
    });
    if (open.status !== 302) {
      throw new Error(`Expected /open to return 302, got ${open.status}`);
    }
    const cookie = extractProxyCookie(open.headers);
    const location = open.headers.get('location');
    if (!location?.endsWith(`/api/ide/sessions/${sessionId}/proxy/`) && location !== `/api/ide/sessions/${sessionId}/proxy/`) {
      throw new Error(`Unexpected /open redirect location: ${location}`);
    }

    await waitForProxyHealth(sessionId, cookie);
    console.log(`[ok] E2B IDE smoke passed: session=${sessionId}, template=${TEMPLATE_NAME}`);
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
  const response = await fetch(resolveUrl(pathOrUrl), {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${pathOrUrl} failed: ${response.status} ${body}`);
  }
  return JSON.parse(body) as T;
}

async function waitForProxyHealth(id: string, cookie: string): Promise<void> {
  const startedAt = Date.now();
  let lastStatus = 0;
  let lastBody = '';

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const response = await fetch(resolveUrl(`/api/ide/sessions/${id}/proxy/healthz`), {
      headers: { cookie },
    });
    lastStatus = response.status;
    if (response.ok) {
      return;
    }
    lastBody = await response.text().catch(() => '');
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for proxied code-server healthz: status=${lastStatus} body=${lastBody}`);
}

async function getPrivateSession(id: string): Promise<StoredIdeSession> {
  const session = await sessionStore.get(id);
  if (!session) {
    throw new Error(`IDE session was not persisted: ${id}`);
  }
  if (!session.host || !session.trafficAccessToken) {
    throw new Error('IDE session is missing private provider routing data');
  }
  return session;
}

async function assertDirectHostRejectsUnauthenticatedTraffic(session: StoredIdeSession): Promise<void> {
  const response = await fetch(`https://${session.host}/healthz`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(DIRECT_HOST_TIMEOUT_MS),
  });
  if (response.ok) {
    throw new Error('Direct E2B host accepted unauthenticated traffic; expected MyCC proxy-only access');
  }
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`Direct E2B host returned unexpected unauthenticated status: ${response.status}`);
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
  console.log(`[cleanup] E2B IDE smoke cleanup complete: session=${id}`);
}

function assertNoProviderSecrets(session: IdeSessionResponse['data']): void {
  if (session.host || session.trafficAccessToken) {
    throw new Error('IDE session response leaked provider secrets');
  }
}

function extractProxyCookie(headers: Headers): string {
  const cookies = getSetCookie(headers);
  const proxyCookie = cookies.find((cookie) => cookie.includes('mycc_ide_'));
  if (!proxyCookie || !proxyCookie.includes('HttpOnly')) {
    throw new Error(`Missing HttpOnly IDE proxy cookie: ${cookies.join(', ')}`);
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
  console.error('[error] E2B IDE smoke failed:', error);
  process.exitCode = 1;
});
