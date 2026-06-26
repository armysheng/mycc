import { randomUUID } from 'node:crypto';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan, type E2bCodeServerSessionPlan } from './service.js';
import type { IdeSessionStore, IdeSessionReuseCriteria, StoredIdeSession } from './session-store.js';
import {
  buildClaudeHomeTemplateSeedCommand,
  buildWorkspaceTemplateSeedCommand,
  listUserClaudeHomeTemplateFiles,
  listUserWorkspaceTemplateFiles,
} from '../workspace/user-workspace-template.js';

export type E2bIdeSessionProvider = Partial<Pick<E2bSandboxProvider, 'startCodeServer' | 'renewCodeServer' | 'runCommandInSession' | 'stopCodeServer'>>;
type E2bIdeSessionProviderWithStart = Pick<E2bSandboxProvider, 'startCodeServer'> & E2bIdeSessionProvider;

const pendingSessionsByIdentity = new Map<string, Promise<StoredIdeSession>>();
const MIN_RENEW_BEFORE_MS = 60_000;

export async function ensureE2bIdeSession(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  sessionStore: IdeSessionStore;
  e2bProvider: E2bIdeSessionProvider;
  env?: NodeJS.ProcessEnv;
  missingStartCodeServerMessage?: string;
  skipReusable?: boolean;
}): Promise<StoredIdeSession> {
  const plan = buildE2bCodeServerSessionPlan({
    userId: params.userId,
    linuxUser: params.linuxUser,
    workspaceDir: params.workspaceDir,
  }, params.env);
  const reuseCriteria = buildReuseCriteria(plan);

  if (!params.skipReusable) {
    const reusable = await params.sessionStore.findReusableByUser(params.userId, reuseCriteria);
    if (reusable) {
      return renewReusableSessionIfNeeded({
        ...params,
        plan,
        session: reusable,
      });
    }
  }
  if (!params.e2bProvider.startCodeServer) {
    throw new Error(params.missingStartCodeServerMessage || 'E2B provider cannot create IDE sessions');
  }
  const e2bProvider = params.e2bProvider as E2bIdeSessionProviderWithStart;

  const pendingKey = buildPendingSessionKey(params.userId, reuseCriteria);
  const pending = pendingSessionsByIdentity.get(pendingKey);
  if (pending) {
    return pending;
  }

  const creation = createAndStoreE2bIdeSession({ ...params, e2bProvider, plan }).finally(() => {
    pendingSessionsByIdentity.delete(pendingKey);
  });
  pendingSessionsByIdentity.set(pendingKey, creation);
  return creation;
}

async function renewReusableSessionIfNeeded(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  sessionStore: IdeSessionStore;
  e2bProvider: E2bIdeSessionProvider;
  plan: E2bCodeServerSessionPlan;
  env?: NodeJS.ProcessEnv;
  session: StoredIdeSession;
}): Promise<StoredIdeSession> {
  if (!params.e2bProvider.renewCodeServer) {
    return params.session;
  }

  if (!shouldRenewSession(params.session, params.plan.sessionTtlSeconds)) {
    return params.session;
  }

  try {
    const renewed = await params.e2bProvider.renewCodeServer(
      params.session,
      params.plan.sessionTtlSeconds,
    );
    const updated: StoredIdeSession = {
      ...params.session,
      ...renewed,
      status: 'running',
    };
    await params.sessionStore.set(updated);
    return updated;
  } catch {
    // Renewal is opportunistic. Keep using the live session instead of forcing
    // a new sandbox when the provider has a transient lease API issue.
    return params.session;
  }
}

function shouldRenewSession(session: StoredIdeSession, sessionTtlSeconds: number): boolean {
  const ttlMs = sessionTtlSeconds * 1000;
  const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
  const renewBeforeMs = Math.max(MIN_RENEW_BEFORE_MS, Math.floor(ttlMs / 2));
  return remainingMs <= renewBeforeMs;
}

async function createAndStoreE2bIdeSession(params: {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  sessionStore: IdeSessionStore;
  e2bProvider: E2bIdeSessionProviderWithStart;
  plan: E2bCodeServerSessionPlan;
  env?: NodeJS.ProcessEnv;
}): Promise<StoredIdeSession> {
  const started = await params.e2bProvider.startCodeServer(params.plan);
  const session: StoredIdeSession = {
    ...started,
    id: randomUUID(),
    template: params.plan.template,
    linuxUser: params.plan.linuxUser,
    workspaceDir: params.plan.workspaceDir,
    proxyToken: randomUUID(),
    userId: params.userId,
    status: 'running',
  };
  try {
    await seedWorkspaceTemplateIfAvailable({
      e2bProvider: params.e2bProvider,
      session,
      claudeHomeDir: `/home/${params.plan.linuxUser}/.claude`,
      workspaceDir: params.plan.workspaceDir,
    });
    await params.sessionStore.set(session);
    return session;
  } catch (error) {
    await stopStartedSessionAfterCreateFailure(params.e2bProvider, session);
    throw error;
  }
}

function buildReuseCriteria(plan: E2bCodeServerSessionPlan): IdeSessionReuseCriteria {
  return {
    template: plan.template,
    linuxUser: plan.linuxUser,
    workspaceDir: plan.workspaceDir,
    port: plan.port,
  };
}

function buildPendingSessionKey(userId: number, criteria: IdeSessionReuseCriteria): string {
  return [
    userId,
    criteria.template,
    criteria.linuxUser,
    criteria.workspaceDir,
    criteria.port,
  ].join('\0');
}

async function seedWorkspaceTemplateIfAvailable(params: {
  e2bProvider: E2bIdeSessionProviderWithStart & E2bIdeSessionProvider;
  session: StoredIdeSession;
  claudeHomeDir: string;
  workspaceDir: string;
}) {
  if (!params.e2bProvider.runCommandInSession) return;

  const claudeHomeFiles = listUserClaudeHomeTemplateFiles();
  if (claudeHomeFiles.length > 0) {
    const result = await params.e2bProvider.runCommandInSession(
      params.session,
      buildClaudeHomeTemplateSeedCommand({
        claudeHomeDir: params.claudeHomeDir,
        files: claudeHomeFiles,
      }),
      {
        cwd: params.claudeHomeDir,
        timeoutMs: 30_000,
      },
    );

    if (result.exitCode !== 0) {
      throw new Error('E2B Claude home template seed failed');
    }
  }

  const workspaceFiles = listUserWorkspaceTemplateFiles({
    overwrite: (relativePath) => relativePath === 'CLAUDE.md',
  });
  if (workspaceFiles.length === 0) return;

  const result = await params.e2bProvider.runCommandInSession(
    params.session,
    buildWorkspaceTemplateSeedCommand({
      workspaceDir: params.workspaceDir,
      files: workspaceFiles,
    }),
    {
      cwd: params.workspaceDir,
      timeoutMs: 30_000,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error('E2B workspace template seed failed');
  }
}

async function stopStartedSessionAfterCreateFailure(
  e2bProvider: E2bIdeSessionProvider,
  session: StoredIdeSession,
): Promise<void> {
  if (!e2bProvider.stopCodeServer) return;
  try {
    await e2bProvider.stopCodeServer(session);
  } catch (error) {
    console.warn(
      '[E2B IDE] failed to clean up session after create failure:',
      error instanceof Error ? error.message : String(error),
    );
  }
}
