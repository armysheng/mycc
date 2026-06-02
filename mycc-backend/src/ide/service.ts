import {
  buildCodeServerStartCommand,
  DEFAULT_CODE_SERVER_PORT,
  validateCodeServerPort,
  validateIdeWorkspaceDir,
} from './code-server.js';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export type IdeProviderKind = 'disabled' | 'e2b';
export type IdeAccessMode = 'mycc-proxy';

export type IdeConfig = {
  provider: IdeProviderKind;
  codeServerPort: number;
  sessionTtlSeconds: number;
  e2bTemplate?: string;
  desktopEnabled?: boolean;
  desktopPort?: number;
};

export type E2bCodeServerSessionPlan = {
  provider: 'e2b';
  template: string;
  userId: number;
  linuxUser: string;
  workspaceDir: string;
  port: number;
  sessionTtlSeconds: number;
  desktopEnabled: boolean;
  allowPublicTraffic: false;
  accessMode: IdeAccessMode;
  startCommand: string;
};

export type BuildE2bCodeServerSessionPlanParams = {
  userId: number;
  linuxUser: string;
  workspaceDir: string;
};

const DEFAULT_E2B_ASSISTANT_TEMPLATE = 'mycc-assistant-sandbox-dev';
const DEFAULT_E2B_TEMPLATE = DEFAULT_E2B_ASSISTANT_TEMPLATE;
const DEFAULT_IDE_SESSION_TTL_SECONDS = 3600;
const DEFAULT_E2B_LINUX_USER = 'mycc';
export const DEFAULT_DESKTOP_NOVNC_PORT = 16080;

export function resolveIdeConfig(env: NodeJS.ProcessEnv = process.env): IdeConfig {
  const provider = resolveProviderKind(env.MYCC_IDE_PROVIDER);
  const codeServerPort = validateCodeServerPort(parsePositiveInteger(
    env.MYCC_IDE_PORT,
    DEFAULT_CODE_SERVER_PORT,
    'MYCC_IDE_PORT',
  ));
  const sessionTtlSeconds = parsePositiveInteger(
    env.MYCC_IDE_SESSION_TTL_SECONDS,
    DEFAULT_IDE_SESSION_TTL_SECONDS,
    'MYCC_IDE_SESSION_TTL_SECONDS',
  );

  if (env.MYCC_E2B_ALLOW_PUBLIC_TRAFFIC === 'true') {
    throw new Error('MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=true is not allowed for IDE sessions');
  }

  const e2bTemplate = env.MYCC_E2B_TEMPLATE || DEFAULT_E2B_TEMPLATE;
  const desktopEnabled = provider === 'e2b' ? resolveDesktopEnabled(env, e2bTemplate) : false;

  return {
    provider,
    codeServerPort,
    sessionTtlSeconds,
    ...(provider === 'e2b' ? {
      e2bTemplate,
      ...(desktopEnabled ? {
        desktopEnabled: true,
        desktopPort: validateCodeServerPort(parsePositiveInteger(
          env.MYCC_E2B_DESKTOP_PORT,
          DEFAULT_DESKTOP_NOVNC_PORT,
          'MYCC_E2B_DESKTOP_PORT',
        )),
      } : {}),
    } : {}),
  };
}

export function buildE2bCodeServerSessionPlan(
  params: BuildE2bCodeServerSessionPlanParams,
  env: NodeJS.ProcessEnv = process.env,
): E2bCodeServerSessionPlan {
  const config = resolveIdeConfig(env);
  if (config.provider !== 'e2b') {
    throw new Error('IDE provider is disabled');
  }

  const linuxUser = resolveE2bLinuxUser(env);
  const workspaceDir = resolveE2bWorkspaceDir(env, linuxUser);
  const port = config.codeServerPort;

  return {
    provider: 'e2b',
    template: config.e2bTemplate ?? DEFAULT_E2B_TEMPLATE,
    userId: params.userId,
    linuxUser,
    workspaceDir,
    port,
    sessionTtlSeconds: config.sessionTtlSeconds,
    desktopEnabled: Boolean(config.desktopEnabled),
    allowPublicTraffic: false,
    accessMode: 'mycc-proxy',
    startCommand: buildCodeServerStartCommand({
      linuxUser,
      port,
      workspaceDir,
    }),
  };
}

function resolveE2bLinuxUser(env: NodeJS.ProcessEnv): string {
  return sanitizeLinuxUsername(env.MYCC_E2B_LINUX_USER || DEFAULT_E2B_LINUX_USER);
}

function resolveE2bWorkspaceDir(env: NodeJS.ProcessEnv, linuxUser: string): string {
  return validateIdeWorkspaceDir(linuxUser, env.MYCC_E2B_WORKSPACE_DIR || `/home/${linuxUser}/workspace`);
}

function resolveProviderKind(raw: string | undefined): IdeProviderKind {
  const provider = (raw || 'disabled').trim();
  if (provider === 'disabled' || provider === 'e2b') {
    return provider;
  }
  throw new Error(`Unsupported IDE provider: ${provider}`);
}

function resolveDesktopEnabled(env: NodeJS.ProcessEnv, template: string): boolean {
  const raw = env.MYCC_E2B_DESKTOP_ENABLED?.trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return template === DEFAULT_E2B_ASSISTANT_TEMPLATE;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}
