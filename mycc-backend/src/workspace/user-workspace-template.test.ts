import { describe, expect, it } from 'vitest';
import {
  listUserClaudeHomeTemplateFiles,
  listUserWorkspaceTemplateFiles,
} from './user-workspace-template.js';

function decode(contentBase64: string): string {
  return Buffer.from(contentBase64, 'base64').toString('utf8');
}

describe('user workspace template mapping', () => {
  it('keeps user memory templates in Claude home with current path copy', () => {
    const files = listUserClaudeHomeTemplateFiles();
    const byPath = new Map(files.map((file) => [file.path, decode(file.contentBase64)]));

    expect(byPath.has('CLAUDE.md')).toBe(true);
    expect(byPath.has('about-me/README.md')).toBe(true);
    expect(byPath.get('CLAUDE.md')).toContain('~/.claude/about-me/README.md');
    expect(byPath.get('CLAUDE.md')).not.toContain('0-System/about-me');
    expect(byPath.get('about-me/README.md')).toContain('~/.claude/about-me/');
    expect(byPath.get('about-me/README.md')).not.toContain('0-System/about-me');
  });

  it('does not seed user identity or memory files into the project workspace', () => {
    const files = listUserWorkspaceTemplateFiles();
    const paths = files.map((file) => file.path);
    const workspaceClaude = files.find((file) => file.path === 'CLAUDE.md');

    expect(paths).toContain('CLAUDE.md');
    expect(paths.some((item) => item.startsWith('0-System/'))).toBe(false);
    expect(paths.some((item) => item.startsWith('.claude/'))).toBe(false);
    expect(decode(workspaceClaude!.contentBase64)).toContain('~/.claude/about-me/');
    expect(decode(workspaceClaude!.contentBase64)).not.toContain('0-System/about-me');
  });
});
