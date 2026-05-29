import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from './service.js';

describe('E2bSandboxProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MYCC_E2B_API_KEY;
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
  });

  it('creates a private E2B sandbox and starts code-server in the background', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b-key';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    const run = vi.fn().mockResolvedValue({ pid: 1234 });
    const create = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      trafficAccessToken: 'traffic-token',
      commands: { run },
      getHost: vi.fn().mockReturnValue('18080-sbx_123.e2b.app'),
    });
    const provider = new E2bSandboxProvider({ create });

    const plan = buildE2bCodeServerSessionPlan({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });
    const session = await provider.startCodeServer(plan);

    expect(create).toHaveBeenCalledWith('mycc-code-server-dev', {
      apiKey: 'e2b-key',
      timeoutMs: 3600000,
      metadata: {
        app: 'mycc',
        capability: 'code-server',
        linuxUser: 'tester',
        userId: '42',
      },
      network: {
        allowPublicTraffic: false,
      },
    });
    expect(run).toHaveBeenCalledWith(plan.startCommand, {
      background: true,
      cwd: '/home/tester/workspace',
    });
    expect(session).toEqual({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: expect.any(String),
    });
  });

  it('requires an E2B API key before creating sandboxes', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const create = vi.fn();
    const provider = new E2bSandboxProvider({ create });
    const plan = buildE2bCodeServerSessionPlan({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });

    await expect(provider.startCodeServer(plan)).rejects.toThrow('MYCC_E2B_API_KEY is required');
    expect(create).not.toHaveBeenCalled();
  });
});
