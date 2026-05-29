import { afterEach, describe, expect, it } from 'vitest';
import {
  buildE2bCodeServerSessionPlan,
  resolveIdeConfig,
} from './service.js';

describe('IDE session service config', () => {
  afterEach(() => {
    delete process.env.MYCC_IDE_PROVIDER;
    delete process.env.MYCC_E2B_TEMPLATE;
    delete process.env.MYCC_E2B_ALLOW_PUBLIC_TRAFFIC;
    delete process.env.MYCC_IDE_PORT;
    delete process.env.MYCC_IDE_SESSION_TTL_SECONDS;
    delete process.env.MYCC_E2B_LINUX_USER;
    delete process.env.MYCC_E2B_WORKSPACE_DIR;
  });

  it('keeps remote IDE disabled by default', () => {
    expect(resolveIdeConfig()).toEqual({
      provider: 'disabled',
      codeServerPort: 18080,
      sessionTtlSeconds: 3600,
    });
  });

  it('builds an E2B code-server plan that requires the mycc proxy', () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_TEMPLATE = 'mycc-code-server-dev';

    const plan = buildE2bCodeServerSessionPlan({
      linuxUser: 'tester',
      userId: 42,
      workspaceDir: '/home/tester/workspace',
    });

    expect(plan).toEqual({
      provider: 'e2b',
      template: 'mycc-code-server-dev',
      userId: 42,
      linuxUser: 'mycc',
      workspaceDir: '/home/mycc/workspace',
      port: 18080,
      sessionTtlSeconds: 3600,
      allowPublicTraffic: false,
      accessMode: 'mycc-proxy',
      startCommand: expect.stringContaining("'code-server'"),
    });
  });

  it('uses the E2B template linux user instead of the product linux user', () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_LINUX_USER = 'mycc';

    const plan = buildE2bCodeServerSessionPlan({
      linuxUser: 'tester',
      userId: 42,
      workspaceDir: '/home/tester/workspace',
    });

    expect(plan.linuxUser).toBe('mycc');
    expect(plan.workspaceDir).toBe('/home/mycc/workspace');
    expect(plan.startCommand).toContain("'/home/mycc/workspace'");
  });

  it('rejects public E2B traffic for product IDE sessions', () => {
    process.env.MYCC_IDE_PROVIDER = 'e2b';
    process.env.MYCC_E2B_ALLOW_PUBLIC_TRAFFIC = 'true';

    expect(() => resolveIdeConfig())
      .toThrow('MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=true is not allowed for IDE sessions');
  });

  it('rejects invalid code-server ports at config resolution time', () => {
    process.env.MYCC_IDE_PORT = '65536';

    expect(() => resolveIdeConfig())
      .toThrow('Invalid code-server port: 65536');
  });
});
