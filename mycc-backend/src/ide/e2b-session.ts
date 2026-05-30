import { randomUUID } from 'node:crypto';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from './service.js';
import type { IdeSessionStore, StoredIdeSession } from './session-store.js';

export type E2bIdeSessionProvider = Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;
type E2bIdeSessionProviderWithStart = Pick<E2bSandboxProvider, 'startCodeServer'>;

const pendingSessionsByStore = new WeakMap<IdeSessionStore, Map<number, Promise<StoredIdeSession>>>();

function getPendingSessionsForStore(sessionStore: IdeSessionStore): Map<number, Promise<StoredIdeSession>> {
  let pending = pendingSessionsByStore.get(sessionStore);
  if (!pending) {
    pending = new Map();
    pendingSessionsByStore.set(sessionStore, pending);
  }
  return pending;
}

export async function ensureE2bIdeSession(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  sessionStore: IdeSessionStore;
  e2bProvider: E2bIdeSessionProvider;
  env?: NodeJS.ProcessEnv;
  missingStartCodeServerMessage?: string;
}): Promise<StoredIdeSession> {
  const reusable = await params.sessionStore.findReusableByUser(params.userId);
  if (reusable) {
    return reusable;
  }
  if (!params.e2bProvider.startCodeServer) {
    throw new Error(params.missingStartCodeServerMessage || 'E2B provider cannot create IDE sessions');
  }
  const e2bProvider = params.e2bProvider as E2bIdeSessionProviderWithStart;

  const pendingSessions = getPendingSessionsForStore(params.sessionStore);
  const pending = pendingSessions.get(params.userId);
  if (pending) {
    return pending;
  }

  const creation = createAndStoreE2bIdeSession({ ...params, e2bProvider }).finally(() => {
    pendingSessions.delete(params.userId);
  });
  pendingSessions.set(params.userId, creation);
  return creation;
}

async function createAndStoreE2bIdeSession(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  sessionStore: IdeSessionStore;
  e2bProvider: E2bIdeSessionProviderWithStart;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredIdeSession> {
  const plan = buildE2bCodeServerSessionPlan({
    userId: params.userId,
    linuxUser: params.linuxUser,
    workspaceDir: params.workspaceDir,
  }, params.env);
  const started = await params.e2bProvider.startCodeServer(plan);
  const session: StoredIdeSession = {
    ...started,
    id: randomUUID(),
    proxyToken: randomUUID(),
    userId: params.userId,
    status: 'running',
  };
  await params.sessionStore.set(session);
  return session;
}
