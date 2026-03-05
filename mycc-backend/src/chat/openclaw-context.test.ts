import { describe, expect, it } from 'vitest';
import {
  buildBootstrapContextFiles,
  buildProjectContextPrompt,
  injectProjectContextPrompt,
  type WorkspaceBootstrapFile,
} from './openclaw-context.js';

describe('openclaw-context', () => {
  it('builds project context prompt with SOUL guidance', () => {
    const files: WorkspaceBootstrapFile[] = [
      {
        name: 'SOUL.md',
        path: '/home/u/workspace/SOUL.md',
        content: '# SOUL',
        missing: false,
      },
      {
        name: 'USER.md',
        path: '/home/u/workspace/USER.md',
        content: '# USER',
        missing: false,
      },
    ];

    const contextFiles = buildBootstrapContextFiles(files);
    const prompt = buildProjectContextPrompt(contextFiles);
    const merged = injectProjectContextPrompt('你好', prompt);

    expect(prompt).toContain('# Project Context');
    expect(prompt).toContain('If SOUL.md is present, embody its persona and tone.');
    expect(prompt).toContain('`0-System/about-me/` is the single source of truth.');
    expect(merged).toContain('## User Request');
    expect(merged).toContain('你好');
  });

  it('adds missing marker and enforces truncation budget', () => {
    const giant = 'A'.repeat(500);
    const files: WorkspaceBootstrapFile[] = [
      {
        name: 'AGENTS.md',
        path: '/home/u/workspace/AGENTS.md',
        missing: true,
      },
      {
        name: 'SOUL.md',
        path: '/home/u/workspace/SOUL.md',
        content: giant,
        missing: false,
      },
    ];

    const contextFiles = buildBootstrapContextFiles(files, {
      maxChars: 100,
      totalMaxChars: 200,
    });
    expect(contextFiles[0].content).toContain('[MISSING] Expected at: /home/u/workspace/AGENTS.md');
    expect(contextFiles[1].content).toContain('[...truncated, read SOUL.md for full content...]');
  });
});
