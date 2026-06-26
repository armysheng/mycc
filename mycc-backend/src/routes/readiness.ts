import type { FastifyInstance } from 'fastify';
import { Template } from 'e2b';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../db/client.js';
import { getSSHPool } from '../ssh/pool.js';
import { buildE2bAgentPreflightReport } from '../ide/e2b-preflight.js';
import { validateRegistry } from '../skills/skill-registry.js';
import {
  authorizeDeepReadinessRequest,
  buildHealthResponse,
  buildReadinessResponse,
  type ReadinessCheck,
} from '../startup/readiness.js';

export type ReadinessRouteOptions = {
  env?: NodeJS.ProcessEnv;
  checkDatabase?: () => Promise<unknown>;
  checkRuntime?: () => Promise<ReadinessCheck>;
  checkSsh?: () => Promise<boolean>;
  validateSkills?: () => string[];
};

export function getRuntimeCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return env.SKILLS_CATALOG_DIR || path.join(__dirname, '..', 'skills', 'catalog');
}

export async function checkRuntimeReadiness(env: NodeJS.ProcessEnv = process.env): Promise<ReadinessCheck> {
  const report = await buildE2bAgentPreflightReport({
    env,
    templateExists: (templateName, apiKey) => Template.exists(templateName, { apiKey }),
  });
  if (report.ok) {
    return {
      status: 'pass',
      message: 'E2B Agent preflight ready',
    };
  }
  const failing = report.checks
    .filter((check) => check.status === 'error')
    .map((check) => check.label)
    .join(', ');
  return {
    status: 'fail',
    message: failing ? `E2B Agent preflight failed: ${failing}` : 'E2B Agent preflight failed',
  };
}

export async function registerReadinessRoutes(
  fastify: FastifyInstance,
  options: ReadinessRouteOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const checkDatabase = options.checkDatabase ?? (() => pool.query('SELECT NOW()'));
  const checkSsh = options.checkSsh ?? (async () => {
    const sshPool = getSSHPool();
    return sshPool.testConnection();
  });
  const validateSkills = options.validateSkills ?? (() => validateRegistry(getRuntimeCatalogPath(env)));
  const checkRuntime = options.checkRuntime ?? (() => checkRuntimeReadiness(env));

  // 存活检查：只证明进程可响应，不代表依赖已就绪。
  fastify.get('/health', async () => buildHealthResponse());

  // 就绪检查：用于发布、负载均衡和运维排障。
  fastify.get('/readyz', async (_request, reply) => {
    const readiness = await buildReadinessResponse({
      env,
      checkDatabase,
      checkSsh,
      validateSkills,
    });
    if (!readiness.ready) {
      return reply.status(503).send(readiness);
    }
    return readiness;
  });

  fastify.get('/readyz/deep', async (request, reply) => {
    const auth = authorizeDeepReadinessRequest({
      env,
      headers: request.headers,
    });
    if (!auth.authorized) {
      return reply.status(auth.statusCode).send(auth.body);
    }

    const readiness = await buildReadinessResponse({
      env,
      checkDatabase,
      checkRuntime,
      checkSsh,
      validateSkills,
    });
    if (!readiness.ready) {
      return reply.status(503).send(readiness);
    }
    return readiness;
  });
}
