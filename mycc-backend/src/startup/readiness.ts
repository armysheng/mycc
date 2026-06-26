import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { requireSafeJwtSecret } from '../auth/service.js';
import { shouldInitializeSshAtStartup } from './ssh-startup.js';

export type ReadinessCheckStatus = 'pass' | 'fail' | 'skipped';

export type ReadinessCheck = {
  status: ReadinessCheckStatus;
  message?: string;
};

export type ReadinessResponse = {
  ready: boolean;
  status: 'ok' | 'unavailable';
  timestamp: string;
  checks: {
    database: ReadinessCheck;
    ssh: ReadinessCheck;
    skills: ReadinessCheck;
    runtime: ReadinessCheck;
  };
};

export type DeepReadinessAuthDecision =
  | { authorized: true }
  | {
      authorized: false;
      statusCode: 401;
      body: {
        error: 'readyz_deep_unauthorized';
        status: 'unauthorized';
      };
    };

export const READYZ_DEEP_TOKEN_HEADER = 'x-mycc-readyz-deep-token';

export function requireProductionStartupSecrets(env: NodeJS.ProcessEnv = process.env): void {
  requireSafeJwtSecret(env);
}

export function buildHealthResponse(now: Date = new Date()) {
  return {
    status: 'ok' as const,
    service: 'mycc-backend',
    timestamp: now.toISOString(),
  };
}

export async function buildReadinessResponse(params: {
  env?: NodeJS.ProcessEnv;
  checkDatabase: () => Promise<unknown>;
  checkRuntime?: () => Promise<ReadinessCheck>;
  checkSsh: () => Promise<boolean>;
  validateSkills: () => string[];
  now?: Date;
}): Promise<ReadinessResponse> {
  const env = params.env ?? process.env;
  const checks: ReadinessResponse['checks'] = {
    database: { status: 'pass' },
    ssh: { status: 'skipped', message: 'SSH startup check skipped for configured runtime' },
    skills: { status: 'pass' },
    runtime: { status: 'skipped', message: 'Runtime deep check not requested' },
  };

  try {
    await params.checkDatabase();
  } catch (error) {
    checks.database = {
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (shouldInitializeSshAtStartup(env)) {
    try {
      const sshOk = await params.checkSsh();
      checks.ssh = sshOk
        ? { status: 'pass' }
        : { status: 'fail', message: 'SSH connection test failed' };
    } catch (error) {
      checks.ssh = {
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const missingSkills = params.validateSkills();
  if (missingSkills.length > 0) {
    checks.skills = {
      status: env.NODE_ENV === 'production' ? 'fail' : 'pass',
      message: `${missingSkills.length} skill registry entries are missing`,
    };
  }

  if (params.checkRuntime) {
    try {
      checks.runtime = await params.checkRuntime();
    } catch (error) {
      checks.runtime = {
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const ready = Object.values(checks).every((check) => check.status !== 'fail');
  return {
    ready,
    status: ready ? 'ok' : 'unavailable',
    timestamp: (params.now ?? new Date()).toISOString(),
    checks,
  };
}

export function authorizeDeepReadinessRequest(params: {
  env?: NodeJS.ProcessEnv;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}): DeepReadinessAuthDecision {
  const env = params.env ?? process.env;
  const configuredToken = env.MYCC_READYZ_DEEP_TOKEN?.trim();

  if (!configuredToken) {
    return deepReadinessUnauthorized();
  }

  const candidateToken = extractDeepReadinessToken(params.headers ?? {});
  if (candidateToken && secureStringEquals(candidateToken, configuredToken)) {
    return { authorized: true };
  }

  return deepReadinessUnauthorized();
}

function deepReadinessUnauthorized(): DeepReadinessAuthDecision {
  return {
    authorized: false,
    statusCode: 401,
    body: {
      error: 'readyz_deep_unauthorized',
      status: 'unauthorized',
    },
  };
}

function extractDeepReadinessToken(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
): string | undefined {
  const authorization = firstHeaderValue(headers.authorization);
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) {
    return bearerToken;
  }

  return firstHeaderValue(headers[READYZ_DEEP_TOKEN_HEADER])?.trim();
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function secureStringEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
