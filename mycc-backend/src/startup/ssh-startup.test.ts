import { describe, expect, it } from 'vitest';
import { shouldInitializeSshAtStartup } from './ssh-startup.js';

describe('shouldInitializeSshAtStartup', () => {
  it('keeps SSH enabled for the default remote Claude path', () => {
    expect(shouldInitializeSshAtStartup({})).toBe(true);
  });

  it('skips SSH startup checks for the full E2B Agent SDK path', () => {
    expect(shouldInitializeSshAtStartup({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_IDE_PROVIDER: 'e2b',
      MYCC_WORKSPACE_PROVIDER: 'e2b',
    })).toBe(false);
  });

  it('keeps SSH enabled when only part of the E2B path is configured', () => {
    expect(shouldInitializeSshAtStartup({
      MYCC_AGENT_RUNTIME: 'e2b-claude-agent-sdk',
      MYCC_IDE_PROVIDER: 'e2b',
    })).toBe(true);
  });

  it('supports an explicit local-smoke override', () => {
    expect(shouldInitializeSshAtStartup({
      MYCC_SKIP_SSH_STARTUP_CHECK: 'true',
    })).toBe(false);
  });
});
