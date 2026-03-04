import { describe, expect, it } from 'vitest';
import { buildBootstrapPrompt, extractBootstrapError } from './onboarding.js';

describe('onboarding bootstrap prompt', () => {
  it('embeds assistant and owner names into first-turn bootstrap message', () => {
    const prompt = buildBootstrapPrompt({
      assistantName: '  cc  ',
      ownerName: '  婷妈  ',
    });

    expect(prompt).toContain('助手名称：cc');
    expect(prompt).toContain('用户称呼：婷妈');
    expect(prompt).toContain('0-System/about-me/BOOTSTRAP.md');
    expect(prompt).toContain('已完成初始化');
  });
});

describe('extractBootstrapError', () => {
  it('returns error message for error event', () => {
    const err = extractBootstrapError({
      type: 'error',
      error: 'network down',
    });
    expect(err).toBe('network down');
  });

  it('treats result.is_error=true as failure', () => {
    const err = extractBootstrapError({
      type: 'result',
      is_error: true,
      result: 'bootstrap failed',
    });
    expect(err).toBe('bootstrap failed');
  });

  it('returns null for successful result', () => {
    const err = extractBootstrapError({
      type: 'result',
      is_error: false,
    });
    expect(err).toBeNull();
  });
});
