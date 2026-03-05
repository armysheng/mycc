import { describe, expect, it } from 'vitest';
import { buildBootstrapPrompt, resolveOnboardingReplayMode } from './onboarding.js';

describe('onboarding bootstrap prompt', () => {
  it('embeds assistant and owner names into first-turn bootstrap message', () => {
    const prompt = buildBootstrapPrompt({
      assistantName: '  cc  ',
      ownerName: '  婷妈  ',
      linuxUser: 'mycc_u2',
      bootstrapToken: 'ticket-123',
    });

    expect(prompt).toContain('助手名称：cc');
    expect(prompt).toContain('用户称呼：婷妈');
    expect(prompt).toContain('0-System/about-me/BOOTSTRAP.md');
    expect(prompt).toContain('/home/mycc_u2/workspace/CLAUDE.md');
    expect(prompt).toContain('/home/mycc_u2/.claude/projects/-home-mycc-u2-workspace/memory/MEMORY.md');
    expect(prompt).toContain('以 `0-System/about-me/` 作为唯一身份真相源');
    expect(prompt).toContain('确保存在 0-System/memory/ 目录');
    expect(prompt).toContain('初始化票据：ticket-123');
    expect(prompt).toContain('已完成初始化');
  });
});

describe('resolveOnboardingReplayMode', () => {
  it('defaults to keep when user is already initialized', () => {
    expect(resolveOnboardingReplayMode({ userInitialized: true })).toBe('keep');
  });

  it('defaults to modify when user is not initialized', () => {
    expect(resolveOnboardingReplayMode({ userInitialized: false })).toBe('modify');
  });

  it('respects explicit replay mode', () => {
    expect(resolveOnboardingReplayMode({ userInitialized: true, requestedMode: 'modify' })).toBe('modify');
    expect(resolveOnboardingReplayMode({ userInitialized: true, requestedMode: 'reset' })).toBe('reset');
    expect(resolveOnboardingReplayMode({ userInitialized: false, requestedMode: 'keep' })).toBe('modify');
  });
});
