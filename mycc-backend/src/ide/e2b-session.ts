import { randomUUID } from 'node:crypto';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from './service.js';
import type { IdeSessionStore, StoredIdeSession } from './session-store.js';

export type E2bIdeSessionProvider = Partial<Pick<E2bSandboxProvider, 'startCodeServer'>>;

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
