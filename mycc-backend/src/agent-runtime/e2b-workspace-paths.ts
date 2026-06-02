import path from 'node:path';
import { sanitizeLinuxUsername } from '../utils/validation.js';

export function resolveSandboxWorkspaceRoot(sandboxUser: string): string {
  const safeSandboxUser = sanitizeLinuxUsername(sandboxUser);
  const defaultRoot = path.posix.join('/home', safeSandboxUser, 'workspace');
  const configured = process.env.MYCC_E2B_WORKSPACE_DIR?.trim();

  if (configured?.includes('\0')) {
    throw new Error('Invalid E2B workspace directory');
  }

  const root = stripTrailingSlash(path.posix.normalize(configured || defaultRoot));
  if (root !== defaultRoot && !root.startsWith(`${defaultRoot}/`)) {
    throw new Error(`Invalid E2B workspace directory: ${configured}`);
  }

  return root;
}

export function resolveSandboxTaskCwd(params: {
  requestedCwd?: string;
  requestedLinuxUser: string;
  sandboxWorkspaceRoot: string;
}): string {
  const sourceUser = sanitizeLinuxUsername(params.requestedLinuxUser);
  const sourceRoot = path.posix.join('/home', sourceUser, 'workspace');
  const requested = params.requestedCwd?.trim();

  if (requested?.includes('\0')) {
    throw new Error('Invalid working directory');
  }

  const normalizedRequested = requested
    ? normalizeUserWorkspaceCwd(sourceRoot, requested)
    : sourceRoot;
  const relativePath = normalizedRequested === sourceRoot
    ? ''
    : normalizedRequested.slice(sourceRoot.length + 1);
  const sandboxCwd = relativePath
    ? path.posix.join(params.sandboxWorkspaceRoot, relativePath)
    : params.sandboxWorkspaceRoot;

  if (
    sandboxCwd !== params.sandboxWorkspaceRoot
    && !sandboxCwd.startsWith(`${params.sandboxWorkspaceRoot}/`)
  ) {
    throw new Error('Invalid working directory');
  }

  return sandboxCwd;
}

function normalizeUserWorkspaceCwd(sourceRoot: string, requested: string): string {
  const normalizedInput = requested.replace(/\\/g, '/');
  const candidate = normalizedInput.startsWith('/home/')
    ? path.posix.normalize(normalizedInput)
    : path.posix.normalize(
        path.posix.join(sourceRoot, normalizedInput.replace(/^\/+/, '')),
      );

  if (candidate !== sourceRoot && !candidate.startsWith(`${sourceRoot}/`)) {
    throw new Error('Invalid working directory');
  }

  return candidate;
}

function stripTrailingSlash(value: string): string {
  if (value === '/') return value;
  return value.replace(/\/+$/, '');
}
