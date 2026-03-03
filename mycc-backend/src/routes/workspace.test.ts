import { afterEach, describe, expect, it } from 'vitest';
import { isWorkspaceExecEnabled, normalizeWorkspacePath } from './workspace.js';

describe('workspace route helpers', () => {
  afterEach(() => {
    delete process.env.WORKSPACE_EXEC_ENABLED;
  });

  it('normalizes root and nested paths', () => {
    expect(normalizeWorkspacePath('/')).toBe('.');
    expect(normalizeWorkspacePath('/src/app.ts')).toBe('src/app.ts');
    expect(normalizeWorkspacePath('src//nested/./a.ts')).toBe('src/nested/a.ts');
  });

  it('rejects traversal paths', () => {
    expect(() => normalizeWorkspacePath('../etc/passwd')).toThrow('非法路径');
    expect(() => normalizeWorkspacePath('/../../secret')).toThrow('非法路径');
  });

  it('disables exec endpoint by default', () => {
    expect(isWorkspaceExecEnabled()).toBe(false);
  });

  it('enables exec endpoint only when explicit true', () => {
    process.env.WORKSPACE_EXEC_ENABLED = 'true';
    expect(isWorkspaceExecEnabled()).toBe(true);

    process.env.WORKSPACE_EXEC_ENABLED = '1';
    expect(isWorkspaceExecEnabled()).toBe(false);
  });
});
