import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { findForbiddenRollbackPatterns } from '../scripts/rollback-preflight-readiness.js';

const execFileAsync = promisify(execFile);

describe('rollback rehearsal preflight', () => {
  it('passes the static no-side-effect rollback gate', async () => {
    const { stdout } = await execFileAsync('npm', ['run', '--silent', 'verify:rollback-preflight'], {
      cwd: new URL('../..', import.meta.url),
      timeout: 15_000,
    });

    expect(stdout).toContain('[ok] package scripts expose rollback preflight gate');
    expect(stdout).toContain('[ok] production runbook documents config-only backend rollback');
    expect(stdout).toContain('[ok] production runbook documents restart cleanup and health checks');
    expect(stdout).toContain('[ok] production runbook forbids destructive database rollback');
    expect(stdout).toContain('[ok] landing readiness keeps rollback rehearsal owner-gated');
    expect(stdout).toContain('[ok] E2B release readiness runs rollback preflight before release checks');
    expect(stdout).toContain('Rollback rehearsal preflight: ready');
  }, 20_000);

  it('detects destructive rollback SQL variants in checked documents', () => {
    const source = [
      'DROP TABLE public.ide_sessions CASCADE;',
      'drop table if exists "agent_runs";',
      'TRUNCATE TABLE public."ide_sessions";',
      'delete from agent_runs;',
    ].join('\n');

    expect(findForbiddenRollbackPatterns(source)).toEqual([
      'DROP TABLE public.ide_sessions',
      'drop table if exists "agent_runs"',
      'TRUNCATE TABLE public."ide_sessions"',
      'delete from agent_runs',
    ]);
  });
});
