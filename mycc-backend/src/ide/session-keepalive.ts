import { E2bSandboxProvider } from './e2b-provider.js';
import { isLikelyStaleE2bSessionError } from './e2b-session-errors.js';
import { resolveIdeConfig } from './service.js';
import { PostgresIdeSessionStore, type IdeSessionStore, type StoredIdeSession } from './session-store.js';

export type IdeSessionKeepaliveResult = {
  scanned: number;
  renewed: number;
  failed: number;
  failures: Array<{
    sessionId: string;
    sandboxId: string;
    error: string;
  }>;
};

export type RenewIdeSessionsExpiringSoonOptions = {
  sessionStore?: IdeSessionStore;
  e2bProvider?: Pick<E2bSandboxProvider, 'renewCodeServer'>;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  limit?: number;
  renewBeforeSeconds?: number;
};

export type IdeSessionKeepaliveScheduler = {
  runOnce(): Promise<IdeSessionKeepaliveResult | null>;
  stop(): void;
};

export type StartIdeSessionKeepaliveSchedulerOptions = RenewIdeSessionsExpiringSoonOptions & {
  intervalMs?: number;
  logger?: Pick<Console, 'log' | 'warn'>;
};

const DEFAULT_KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_KEEPALIVE_LIMIT = 50;
const MIN_RENEW_BEFORE_SECONDS = 60;

export async function renewIdeSessionsExpiringSoon(
  options: RenewIdeSessionsExpiringSoonOptions = {},
): Promise<IdeSessionKeepaliveResult> {
  const env = options.env ?? process.env;
  const config = resolveIdeConfig(env);
  const result: IdeSessionKeepaliveResult = {
    scanned: 0,
    renewed: 0,
    failed: 0,
    failures: [],
  };

  if (config.provider !== 'e2b') {
    return result;
  }

  const sessionStore = options.sessionStore ?? new PostgresIdeSessionStore();
  const e2bProvider = options.e2bProvider ?? new E2bSandboxProvider();
  const now = options.now ?? new Date();
  const renewBeforeSeconds = options.renewBeforeSeconds
    ?? parsePositiveInteger(
      env.MYCC_IDE_KEEPALIVE_RENEW_BEFORE_SECONDS,
      Math.max(MIN_RENEW_BEFORE_SECONDS, Math.floor(config.sessionTtlSeconds / 2)),
      'MYCC_IDE_KEEPALIVE_RENEW_BEFORE_SECONDS',
    );
  const cutoff = new Date(now.getTime() + renewBeforeSeconds * 1000);
  const sessions = await sessionStore.findExpiredRunning(
    cutoff,
    options.limit ?? DEFAULT_KEEPALIVE_LIMIT,
  );
  result.scanned = sessions.length;

  for (const session of sessions) {
    try {
      const renewed = await e2bProvider.renewCodeServer(
        session,
        config.sessionTtlSeconds,
      );
      await markRenewed(sessionStore, session, renewed);
      result.renewed += 1;
    } catch (error) {
      if (isLikelyStaleE2bSessionError(error)) {
        await sessionStore.set({ ...session, status: 'stopped' });
      }
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

export function shouldStartIdeSessionKeepalive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MYCC_IDE_KEEPALIVE_ENABLED === 'false') {
    return false;
  }
  try {
    return resolveIdeConfig(env).provider === 'e2b';
  } catch {
    return false;
  }
}

export function startIdeSessionKeepaliveScheduler(
  options: StartIdeSessionKeepaliveSchedulerOptions = {},
): IdeSessionKeepaliveScheduler {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const intervalMs = options.intervalMs
    ?? parsePositiveInteger(
      env.MYCC_IDE_KEEPALIVE_INTERVAL_MS,
      DEFAULT_KEEPALIVE_INTERVAL_MS,
      'MYCC_IDE_KEEPALIVE_INTERVAL_MS',
    );
  let running = false;

  const runOnce = async (): Promise<IdeSessionKeepaliveResult | null> => {
    if (running) {
      return null;
    }
    running = true;
    try {
      const result = await renewIdeSessionsExpiringSoon(options);
      if (result.scanned > 0 || result.failed > 0) {
        logger.log(JSON.stringify({
          event: 'ide_sessions_keepalive',
          ...result,
        }));
      }
      return result;
    } catch (error) {
      logger.warn('[IdeSessionKeepalive] tick failed:', error);
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref?.();
  void runOnce();

  return {
    runOnce,
    stop() {
      clearInterval(timer);
    },
  };
}

async function markRenewed(
  sessionStore: IdeSessionStore,
  session: StoredIdeSession,
  renewed: Partial<StoredIdeSession>,
): Promise<void> {
  await sessionStore.set({
    ...session,
    ...renewed,
    status: 'running',
  });
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}
