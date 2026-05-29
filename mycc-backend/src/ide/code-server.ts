import path from 'node:path';
import { escapeShellArg, sanitizeLinuxUsername } from '../utils/validation.js';

export const DEFAULT_CODE_SERVER_PORT = 18080;
export const DEFAULT_CODE_SERVER_IDLE_TIMEOUT_SECONDS = 1800;

export type CodeServerStartOptions = {
  linuxUser: string;
  workspaceDir: string;
  port?: number;
  idleTimeoutSeconds?: number;
};

export function buildCodeServerStartCommand(options: CodeServerStartOptions): string {
  const linuxUser = sanitizeLinuxUsername(options.linuxUser);
  const workspaceDir = validateIdeWorkspaceDir(linuxUser, options.workspaceDir);
  const port = validateCodeServerPort(options.port ?? DEFAULT_CODE_SERVER_PORT);
  const idleTimeoutSeconds = validateIdleTimeout(
    options.idleTimeoutSeconds ?? DEFAULT_CODE_SERVER_IDLE_TIMEOUT_SECONDS,
  );
  const userDataDir = `/home/${linuxUser}/.local/share/code-server`;

  return [
    'code-server',
    '--bind-addr',
    `0.0.0.0:${port}`,
    '--auth',
    'none',
    '--disable-telemetry',
    '--disable-update-check',
    '--idle-timeout-seconds',
    String(idleTimeoutSeconds),
    '--user-data-dir',
    userDataDir,
    '--extensions-dir',
    `${userDataDir}/extensions`,
    workspaceDir,
  ].map(escapeShellArg).join(' ');
}

export function validateIdeWorkspaceDir(linuxUserRaw: string, workspaceDir: string): string {
  const linuxUser = sanitizeLinuxUsername(linuxUserRaw);
  const normalized = path.posix.normalize(workspaceDir);
  const workspaceRoot = `/home/${linuxUser}/workspace`;
  if (normalized !== workspaceRoot && !normalized.startsWith(`${workspaceRoot}/`)) {
    throw new Error(`Invalid IDE workspace directory: ${workspaceDir}`);
  }
  return normalized;
}

export function validateCodeServerPort(port: number): number {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid code-server port: ${port}`);
  }
  return port;
}

function validateIdleTimeout(idleTimeoutSeconds: number): number {
  if (!Number.isInteger(idleTimeoutSeconds) || idleTimeoutSeconds < 60 || idleTimeoutSeconds > 86400) {
    throw new Error(`Invalid code-server idle timeout: ${idleTimeoutSeconds}`);
  }
  return idleTimeoutSeconds;
}
