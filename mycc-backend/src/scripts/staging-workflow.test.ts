import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy-staging.yml');

describe('staging deploy workflow', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  it('runs database migrations before backend build and restart', () => {
    const migrateIndex = workflow.indexOf('npm -C mycc-backend run db:migrate');
    const buildIndex = workflow.indexOf('npm -C mycc-backend run build');
    const restartIndex = workflow.indexOf('restart via custom command');

    expect(migrateIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(migrateIndex);
    expect(restartIndex).toBeGreaterThan(buildIndex);
  });

  it('checks readiness separately from liveness', () => {
    expect(workflow).toContain('Verify backend health endpoint');
    expect(workflow).toContain('Verify backend deep readiness endpoint');
    expect(workflow).toContain('STAGING_BACKEND_READY_URL');
    expect(workflow).toContain('http://127.0.0.1:8080/readyz/deep');
    expect(workflow).toContain('"runtime"[[:space:]]*:[[:space:]]*\\{[^}]*"status"[[:space:]]*:[[:space:]]*"pass"');
  });

  it('passes custom restart commands safely into the remote script', () => {
    expect(workflow).toContain('BACKEND_RESTART_CMD_B64=');
    expect(workflow).toContain('STAGING_BACKEND_RESTART_CMD_B64');
    expect(workflow).toContain('base64 -d');
    expect(workflow).toContain('bash -lc "${STAGING_BACKEND_RESTART_CMD}"');
  });

  it('can pin the remote Node runtime used for deploy commands', () => {
    expect(workflow).toContain('STAGING_NODE_BIN_DIR');
    expect(workflow).toContain('export PATH="${STAGING_NODE_BIN_DIR}:${PATH}"');
    expect(workflow).toContain('STAGING_NODE_BIN_DIR must contain executable node and npm');
  });
});
