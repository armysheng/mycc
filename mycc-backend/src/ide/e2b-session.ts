import { randomUUID } from 'node:crypto';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from './service.js';
import type { IdeSessionStore, StoredIdeSession } from './session-store.js';

export type E2bIdeSessionProvider = Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;
type E2bIdeSessionProviderWithStart = Pick<E2bSandboxProvider, 'startCodeServer'>;

const pendingSessionsByUser = new Map<number, Promise<StoredIdeSession>>();

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

  const pending = pendingSessionsByUser.get(params.userId);
  if (pending) {
    return pending;
  }

  const creation = createAndStoreE2bIdeSession({ ...params, e2bProvider }).finally(() => {
    pendingSessionsByUser.delete(params.userId);
  });
  pendingSessionsByUser.set(params.userId, creation);
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
