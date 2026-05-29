import { E2bSandboxProvider } from './e2b-provider.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from './session-store.js';

export type IdeSessionCleanupResult = {
  scanned: number;
  stopped: number;
  failed: number;
  failures: Array<{
    sessionId: string;
    sandboxId: string;
    error: string;
  }>;
};

export type CleanupExpiredIdeSessionsOptions = {
  sessionStore?: IdeSessionStore;
  e2bProvider?: Pick<E2bSandboxProvider, 'stopCodeServer'>;
  now?: Date;
  limit?: number;
};

export async function cleanupExpiredIdeSessions(
  options: CleanupExpiredIdeSessionsOptions = {},
): Promise<IdeSessionCleanupResult> {
  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const expiredSessions = await sessionStore.findExpiredRunning(now, limit);
  const result: IdeSessionCleanupResult = {
    scanned: expiredSessions.length,
    stopped: 0,
    failed: 0,
    failures: [],
  };

  for (const session of expiredSessions) {
    try {
      await e2bProvider.stopCodeServer(session);
      await markStopped(sessionStore, session);
      result.stopped += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        sessionId: session.id,
        sandboxId: session.sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function markStopped(sessionStore: IdeSessionStore, session: StoredIdeSession): Promise<void> {
  await sessionStore.set({
    ...session,
    status: 'stopped',
  });
}
