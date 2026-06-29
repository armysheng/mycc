import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('E2B release readiness checklist', () => {
  it('passes the static production-readiness gate', async () => {
    const { stdout } = await execFileAsync('npm', ['run', '--silent', 'verify:e2b-release'], {
      cwd: new URL('../..', import.meta.url),
      timeout: 15_000,
    });

    expect(stdout).toContain('[ok] package scripts expose E2B release gates');
    expect(stdout).toContain('[ok] env example documents the E2B product path');
    expect(stdout).toContain('[ok] operator docs expose rollback preflight gate');
    expect(stdout).toContain('[ok] release checklist covers migration, smoke, and rollback');
    expect(stdout).toContain('[ok] deployment guide documents E2B rollback switches');
    expect(stdout).toContain('[ok] agent run trace migration is idempotent');
    expect(stdout).toContain('[ok] IDE session identity migration is idempotent');
    expect(stdout).toContain('[ok] backend index registers readiness routes');
    expect(stdout).toContain('[ok] deep readiness route exposes protected readiness probes');
    expect(stdout).toContain('[ok] deep readiness route requires operator authorization');
    expect(stdout).toContain('[ok] deep readiness probes E2B Agent runtime preflight');
    expect(stdout).toContain('[ok] IDE smoke proves raw E2B host stays private');
    expect(stdout).toContain('[ok] Agent SDK bridge has a local protocol contract');
    expect(stdout).toContain('E2B release readiness: ready');
  }, 20_000);
});
