import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2bSandboxProvider } from './e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from './service.js';

describe('E2bSandboxProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MYCC_E2B_API_KEY;
    delete process.env.E2B_API_KEY;
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
    delete process.env.MYCC_E2B_DESKTOP_PORT;
    delete process.env.MYCC_E2B_DESKTOP_MODE;
    delete process.env.MYCC_E2B_CREATE_RETRY_ATTEMPTS;
    delete process.env.MYCC_E2B_CREATE_RETRY_DELAY_MS;
    delete process.env.MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS;
  });

  it('creates a private E2B sandbox, starts code-server, and waits for health', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' });
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
      apiKey: 'e2b_deadbeef',
      timeoutMs: 3600000,
      metadata: {
        app: 'mycc',
        capability: 'code-server',
        linuxUser: 'mycc',
        userId: '42',
      },
      network: {
        allowPublicTraffic: false,
      },
    });
    expect(run).toHaveBeenNthCalledWith(1, expect.stringContaining('nohup'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 10000,
    });
    expect(run.mock.calls[0]?.[0]).toContain('sh -lc');
    expect(run.mock.calls[0]?.[0]).toContain('code-server');
    expect(run.mock.calls[0]?.[0]).toContain('0.0.0.0:18080');
    expect(run.mock.calls[0]?.[0]).toContain('/tmp/mycc-code-server-18080.stdout.log');
    expect(run.mock.calls[0]?.[0]).toContain('echo $!');
    expect(run).toHaveBeenNthCalledWith(2, expect.stringContaining('127.0.0.1:18080/healthz'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run).toHaveBeenCalledTimes(2);
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

  it('fails session creation when code-server never becomes healthy', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS = '1';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValue({ exitCode: 7, stdout: '', stderr: 'connection refused' });
    const create = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_unhealthy',
      trafficAccessToken: 'traffic-token',
      commands: { run },
      getHost: vi.fn().mockReturnValue('18080-sbx_unhealthy.e2b.app'),
      kill: vi.fn().mockResolvedValue(undefined),
    });
    const provider = new E2bSandboxProvider({ create });
    const plan = buildE2bCodeServerSessionPlan({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });

    await expect(provider.startCodeServer(plan)).rejects.toThrow('code-server did not become ready');
  });

  it('retries transient E2B placement failures while creating a sandbox', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';
    process.env.MYCC_E2B_CREATE_RETRY_DELAY_MS = '0';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('500: Failed to place sandbox'))
      .mockResolvedValueOnce({
        sandboxId: 'sbx_after_retry',
        trafficAccessToken: 'traffic-token',
        commands: { run },
        getHost: vi.fn().mockReturnValue('18080-sbx_after_retry.e2b.app'),
      });
    const provider = new E2bSandboxProvider({ create });

    const plan = buildE2bCodeServerSessionPlan({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });
    const session = await provider.startCodeServer(plan);

    expect(create).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, expect.stringContaining('nohup'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 10000,
    });
    expect(run.mock.calls[0]?.[0]).toContain('sh -lc');
    expect(run.mock.calls[0]?.[0]).toContain('code-server');
    expect(run.mock.calls[0]?.[0]).toContain('0.0.0.0:18080');
    expect(session).toEqual(expect.objectContaining({
      sandboxId: 'sbx_after_retry',
      codeServerPid: 1234,
    }));
  });

  it('prewarms the desktop service for assistant sandboxes without blocking on readiness', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' })
      .mockResolvedValueOnce({ pid: 4321 });
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
    await provider.startCodeServer(plan);

    expect(plan.desktopEnabled).toBe(true);
    expect(run).toHaveBeenNthCalledWith(1, expect.stringContaining('nohup'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 10000,
    });
    expect(run.mock.calls[0]?.[0]).toContain('sh -lc');
    expect(run.mock.calls[0]?.[0]).toContain('code-server');
    expect(run.mock.calls[0]?.[0]).toContain('0.0.0.0:18080');
    expect(run).toHaveBeenNthCalledWith(2, expect.stringContaining('127.0.0.1:18080/healthz'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run).toHaveBeenNthCalledWith(3, 'mycc-start-desktop', {
      background: true,
      cwd: '/home/mycc/workspace',
      envs: {
        MYCC_DESKTOP_MODE: 'browser-only',
        MYCC_DESKTOP_NOVNC_PORT: '16080',
        MYCC_DESKTOP_OPEN_BROWSER: '1',
        MYCC_DESKTOP_RESOLUTION: '1440x900',
        MYCC_DESKTOP_BROWSER_WINDOW_SIZE: '1440,900',
      },
    });
  });

  it('does not fail sandbox creation when desktop prewarm fails', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' })
      .mockRejectedValueOnce(new Error('prewarm failed'));
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

    expect(session.codeServerPid).toBe(1234);
    expect(run).toHaveBeenCalledTimes(3);
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

    await expect(provider.startCodeServer(plan)).rejects.toThrow('MYCC_E2B_API_KEY or E2B_API_KEY is required');
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the generic E2B_API_KEY fallback', async () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.E2B_API_KEY = 'e2b_cafebabe';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1234\n', stderr: '' })
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const create = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      commands: { run },
      getHost: vi.fn().mockReturnValue('18080-sbx_123.e2b.app'),
    });
    const provider = new E2bSandboxProvider({ create });
    const plan = buildE2bCodeServerSessionPlan({
      userId: 42,
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });

    await provider.startCodeServer(plan);

    expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      apiKey: 'e2b_cafebabe',
    }));
  });

  it('kills the code-server process and sandbox when stopping a session', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    const killCommand = vi.fn().mockResolvedValue(true);
    const killSandbox = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({
      commands: { kill: killCommand },
      kill: killSandbox,
    });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    await provider.stopCodeServer({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });

    expect(connect).toHaveBeenCalledWith('sbx_123', { apiKey: 'e2b_deadbeef' });
    expect(killCommand).toHaveBeenCalledWith(1234);
    expect(killSandbox).toHaveBeenCalledOnce();
  });

  it('renews the sandbox timeout for a running session within the E2B one-hour limit', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    const setTimeout = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ setTimeout });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    const result = await provider.renewCodeServer({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    }, 7200);

    expect(connect).toHaveBeenCalledWith('sbx_123', { apiKey: 'e2b_deadbeef' });
    expect(setTimeout).toHaveBeenCalledWith(3600000);
    expect(result.expiresAt).toEqual(expect.any(String));
  });

  it('starts the GNU desktop service inside an existing sandbox', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_E2B_DESKTOP_PORT = '16080';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ pid: 4321 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const getHost = vi.fn().mockReturnValue('16080-sbx_123.e2b.app');
    const connect = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      trafficAccessToken: 'traffic-token',
      commands: { run },
      getHost,
    });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    const desktop = await provider.startDesktop({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });

    expect(connect).toHaveBeenCalledWith('sbx_123', { apiKey: 'e2b_deadbeef' });
    expect(run).toHaveBeenCalledWith('MYCC_DESKTOP_NOVNC_PORT=16080 mycc-health-desktop >/dev/null', {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run).toHaveBeenCalledWith('mycc-start-desktop', {
      background: true,
      cwd: '/home/mycc/workspace',
      envs: {
        MYCC_DESKTOP_MODE: 'browser-only',
        MYCC_DESKTOP_NOVNC_PORT: '16080',
        MYCC_DESKTOP_OPEN_BROWSER: '1',
        MYCC_DESKTOP_RESOLUTION: '1440x900',
        MYCC_DESKTOP_BROWSER_WINDOW_SIZE: '1440,900',
      },
    });
    expect(run).toHaveBeenCalledWith('MYCC_DESKTOP_NOVNC_PORT=16080 mycc-health-desktop >/dev/null', {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(run.mock.calls)).not.toContain('chromium');
    expect(JSON.stringify(run.mock.calls)).not.toContain('traffic-token');
    expect(JSON.stringify(run.mock.calls)).not.toContain('websockify-fallback');
    expect(getHost).toHaveBeenCalledWith(16080);
    expect(desktop).toEqual({
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
  });

  it('returns the template noVNC service instead of starting a second fallback proxy', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_E2B_DESKTOP_PORT = '16080';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ pid: 4321 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const getHost = vi.fn().mockReturnValue('16080-sbx_123.e2b.app');
    const connect = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      trafficAccessToken: 'traffic-token',
      commands: { run },
      getHost,
    });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    const desktop = await provider.startDesktop({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      trafficAccessToken: 'traffic-token',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });

    expect(run).toHaveBeenNthCalledWith(4, 'MYCC_DESKTOP_NOVNC_PORT=16080 mycc-health-desktop >/dev/null', {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(JSON.stringify(run.mock.calls)).not.toContain('websockify-fallback');
    expect(run).toHaveBeenCalledTimes(4);
    expect(desktop).toEqual({
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
  });

  it('reuses an agent-started desktop display instead of launching a second desktop', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_E2B_DESKTOP_PORT = '16080';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '9876\n', stderr: '' });
    const getHost = vi.fn().mockReturnValue('16080-sbx_123.e2b.app');
    const connect = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      commands: { run },
      getHost,
    });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    const desktop = await provider.startDesktop({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });

    expect(run).toHaveBeenNthCalledWith(1, 'MYCC_DESKTOP_NOVNC_PORT=16080 mycc-health-desktop >/dev/null', {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run.mock.calls.map(([command]) => command)).not.toContain('mycc-start-desktop');
    expect(run).toHaveBeenNthCalledWith(2, expect.stringContaining('pgrep -f'), {
      background: false,
      cwd: '/home/mycc/workspace',
      timeoutMs: 5000,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(desktop).toEqual({
      desktopPid: 9876,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
  });

  it('waits for an in-flight desktop prewarm instead of launching a duplicate desktop', async () => {
    process.env.MYCC_E2B_API_KEY = 'e2b_deadbeef';
    process.env.MYCC_E2B_DESKTOP_PORT = '16080';
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '4321\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const getHost = vi.fn().mockReturnValue('16080-sbx_123.e2b.app');
    const connect = vi.fn().mockResolvedValue({
      sandboxId: 'sbx_123',
      commands: { run },
      getHost,
    });
    const provider = new E2bSandboxProvider({ create: vi.fn(), connect });

    const desktop = await provider.startDesktop({
      provider: 'e2b',
      sandboxId: 'sbx_123',
      codeServerPid: 1234,
      host: '18080-sbx_123.e2b.app',
      port: 18080,
      accessMode: 'mycc-proxy',
      expiresAt: '2026-05-29T14:00:00.000Z',
    });

    expect(run.mock.calls.map(([command]) => command)).not.toContain('mycc-start-desktop');
    expect(run).toHaveBeenCalledTimes(3);
    expect(desktop).toEqual({
      desktopPid: 4321,
      desktopHost: '16080-sbx_123.e2b.app',
      desktopPort: 16080,
    });
  });
});
