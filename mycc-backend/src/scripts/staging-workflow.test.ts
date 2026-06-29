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

  it('does not require legacy RSA host keys from the staging server', () => {
    expect(workflow).toContain('ssh-keyscan -p "${STAGING_PORT:-22}" -H "${STAGING_HOST}"');
    expect(workflow).not.toContain('ssh-keyscan -t rsa');
  });

  it('skips remote deploy work for docs-only main pushes', () => {
    expect(workflow).toContain('id: deployment_impact');
    expect(workflow).toContain('${{ github.event.workflow_run.head_sha }}');
    expect(workflow).toContain('git -c core.quotePath=false diff --name-only HEAD^ HEAD');
    expect(workflow).toContain('mycc-backend/docs/*');
    expect(workflow).toContain('docs/*');
    expect(workflow).toContain("should_deploy=false");
    expect(workflow).toContain("should_deploy=true");

    const deployGate = "steps.deployment_impact.outputs.should_deploy == 'true'";
    expect(workflow).toContain(`if: ${deployGate}`);
    expect(workflow.match(new RegExp(deployGate, 'g'))?.length).toBeGreaterThanOrEqual(4);
  });

  it('treats release gate script-only pushes as non-deploying', () => {
    expect(workflow).toContain('mycc-backend/scripts/landing-pr-classify.ts');
    expect(workflow).toContain('mycc-backend/scripts/verify-e2b-release-readiness.ts');
    expect(workflow).toContain('mycc-backend/scripts/harness-verify.ts');
    expect(workflow).toContain('mycc-backend/scripts/agent-eval-static.ts');
  });

  it('treats local manual test scripts as non-deploying', () => {
    expect(workflow).toContain('mycc-backend/test-api.sh');
    expect(workflow).toContain('mycc-backend/test-full.sh');
  });

  it('can deploy frontend-only pushes without backend migrations or restarts', () => {
    expect(workflow).toContain('deploy_frontend=');
    expect(workflow).toContain('deploy_backend=');
    expect(workflow).toContain('DEPLOY_FRONTEND=');
    expect(workflow).toContain('DEPLOY_BACKEND=');
    expect(workflow).toContain('mycc-web-react/*');
    expect(workflow).toContain('STAGING_FRONTEND_DIST_DIR not set, fallback to /var/www/daoyou.iaigc.fun');
    expect(workflow).toContain('FRONTEND_DIST_DIR="${STAGING_FRONTEND_DIST_DIR:-/var/www/daoyou.iaigc.fun}"');
    expect(workflow).toContain('if [ "${DEPLOY_FRONTEND}" = "true" ]; then');
    expect(workflow).toContain('rsync -a --delete mycc-web-react/dist/ "${FRONTEND_DIST_DIR}/"');
    expect(workflow).toContain('if [ "${DEPLOY_BACKEND}" = "true" ]; then');
    expect(workflow).toContain("steps.deployment_impact.outputs.deploy_backend == 'true'");
    expect(workflow).toContain("steps.deployment_impact.outputs.deploy_frontend == 'true'");
    expect(workflow).toContain('FRONTEND_URL="${STAGING_FRONTEND_URL:-https://daoyou.iaigc.fun}"');
  });

  it('treats deploy workflow updates as frontend deployment impact', () => {
    expect(workflow).toContain('.github/workflows/deploy-staging.yml)');
    expect(workflow).toContain('frontend-deploy-workflow-impacting: ${file}');
  });

  it('can authenticate protected deep readiness probes without exposing the token in the URL', () => {
    expect(workflow).toContain('STAGING_BACKEND_READY_TOKEN: ${{ secrets.STAGING_BACKEND_READY_TOKEN }}');
    expect(workflow).toContain('READY_AUTH_HEADER_B64');
    expect(workflow).toContain('Authorization: Bearer %s');
    expect(workflow).toContain('READY_CURL_ARGS=(-H "$(printf');
    expect(workflow).not.toContain('STAGING_BACKEND_READY_URL:-http://127.0.0.1:8080/readyz/deep?token=');
  });
});
