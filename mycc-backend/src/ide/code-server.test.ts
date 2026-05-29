import { describe, expect, it } from 'vitest';
import {
  buildCodeServerStartCommand,
  DEFAULT_CODE_SERVER_PORT,
  validateIdeWorkspaceDir,
} from './code-server.js';

describe('code-server IDE helpers', () => {
  it('builds a proxy-only code-server start command with safe defaults', () => {
    const command = buildCodeServerStartCommand({
      linuxUser: 'tester',
      workspaceDir: '/home/tester/workspace',
    });

    expect(command).toContain("'code-server'");
    expect(command).toContain("'--bind-addr' '0.0.0.0:18080'");
    expect(command).toContain("'--auth' 'none'");
    expect(command).toContain("'--disable-telemetry'");
    expect(command).toContain("'--disable-update-check'");
    expect(command).toContain("'--idle-timeout-seconds' '1800'");
    expect(command).toContain("'--user-data-dir' '/home/tester/.local/share/code-server'");
    expect(command).toContain("'--extensions-dir' '/home/tester/.local/share/code-server/extensions'");
    expect(command.endsWith("'/home/tester/workspace'")).toBe(true);
  });

  it('allows overriding port and idle timeout for sandbox tuning', () => {
    const command = buildCodeServerStartCommand({
      idleTimeoutSeconds: 900,
      linuxUser: 'tester',
      port: 19090,
      workspaceDir: '/home/tester/workspace/project',
    });

    expect(command).toContain("'--bind-addr' '0.0.0.0:19090'");
    expect(command).toContain("'--idle-timeout-seconds' '900'");
    expect(command.endsWith("'/home/tester/workspace/project'")).toBe(true);
  });

  it('rejects workspaces outside the user workspace root', () => {
    expect(() => validateIdeWorkspaceDir('tester', '/home/other/workspace'))
      .toThrow('Invalid IDE workspace directory: /home/other/workspace');
  });

  it('rejects workspaces that escape through parent segments', () => {
    expect(() => validateIdeWorkspaceDir('tester', '/home/tester/workspace/../../other'))
      .toThrow('Invalid IDE workspace directory: /home/tester/workspace/../../other');
  });

  it('rejects unsafe port values', () => {
    expect(DEFAULT_CODE_SERVER_PORT).toBe(18080);
    expect(() => buildCodeServerStartCommand({
      linuxUser: 'tester',
      port: 65536,
      workspaceDir: '/home/tester/workspace',
    })).toThrow('Invalid code-server port: 65536');
  });
});
