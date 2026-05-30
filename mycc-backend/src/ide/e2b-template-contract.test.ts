import { describe, expect, it, vi } from 'vitest';
import {
  assertE2bTemplateContract,
  buildE2bTemplateContractCommand,
} from './e2b-template-contract.js';
import type { StoredIdeSession } from './session-store.js';

const runningSession: StoredIdeSession = {
  id: 'ide_123',
  provider: 'e2b',
  sandboxId: 'sbx_123',
  codeServerPid: 1234,
  host: '18080-sbx_123.e2b.app',
  trafficAccessToken: 'traffic-token',
  port: 18080,
  accessMode: 'mycc-proxy',
  expiresAt: '2099-05-29T14:00:00.000Z',
  proxyToken: 'proxy-token',
  userId: 42,
  status: 'running',
};

describe('E2B template contract', () => {
  it('builds a shell contract check for GNU tooling and runtime dependencies', () => {
    const command = buildE2bTemplateContractCommand({
      requireCodeServer: true,
      requireClaudeCli: true,
      requireAgentSdkBridge: true,
      bridgePath: '/opt/mycc-agent-runtime/bridge.mjs',
    });

    expect(command).toContain('sh -lc');
    expect(command).toContain('command -v "$cmd"');
    expect(command).toContain('code-server');
    expect(command).toContain('claude');
    expect(command).toContain('/opt/mycc-agent-runtime/bridge.mjs');
    expect(command).toContain('sed --version');
    expect(command).toContain('grep --version');
    expect(command).toContain('realpath --version');
  });

  it('runs the contract check inside the E2B workspace', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'E2B template contract ok\n',
      stderr: '',
    });

    await assertE2bTemplateContract({
      e2bProvider: { runCommandInSession },
      session: runningSession,
      workspaceDir: '/home/mycc/workspace',
      requireCodeServer: true,
    });

    expect(runCommandInSession).toHaveBeenCalledWith(
      runningSession,
      expect.stringContaining('sh -lc'),
      {
        cwd: '/home/mycc/workspace',
        timeoutMs: 30000,
      },
    );
  });

  it('throws a clear error when the template misses required tooling', async () => {
    const runCommandInSession = vi.fn().mockResolvedValue({
      exitCode: 42,
      stdout: '',
      stderr: 'E2B template contract missing: command:code-server',
    });

    await expect(assertE2bTemplateContract({
      e2bProvider: { runCommandInSession },
      session: runningSession,
      workspaceDir: '/home/mycc/workspace',
      requireCodeServer: true,
    })).rejects.toThrow('E2B template contract missing: command:code-server');
  });
});
