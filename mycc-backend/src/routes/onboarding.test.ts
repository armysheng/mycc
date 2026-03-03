import { describe, expect, it } from 'vitest';
import { buildBootstrapPrompt } from './onboarding.js';

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
