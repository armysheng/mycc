import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('harness verify script', () => {
  it('redacts child command output before printing or writing reports', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/harness-verify.ts'), 'utf8');

    expect(source).toContain('redactHarnessText');
    expect(source).toContain('stdout: redactHarnessText(result.stdout.trim())');
    expect(source).toContain('stderr: redactHarnessText([');
    expect(source).toContain('result.stderr.trim()');
  });

  it('requires explicit approval before running live side-effect targets', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/harness-verify.ts'), 'utf8');

    expect(source).toContain('MYCC_LIVE_GATE_APPROVED');
    expect(source).toContain('assertLiveTargetApproval');
    expect(source).toContain('LIVE_SIDE_EFFECT_TARGETS');
  });

  it('fail-fasts live gate execution after any failed target', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/harness-verify.ts'), 'utf8');

    expect(source).toContain('runExpandedTargets(expandedTargets)');
    expect(source).toContain('shouldFailFastHarnessRun(expandedTargets)');
    expect(source).toContain('skipped: true');
    expect(source).not.toContain('const results = expandedTargets.map(runTarget)');
  });

  it('bounds child command runtime with a target timeout', () => {
    const source = readFileSync(path.join(backendRoot, 'scripts/harness-verify.ts'), 'utf8');

    expect(source).toContain('DEFAULT_TARGET_TIMEOUT_MS');
    expect(source).toContain('timeoutMs?: number');
    expect(source).toContain('timeout: target.timeoutMs ?? DEFAULT_TARGET_TIMEOUT_MS');
  });
});
