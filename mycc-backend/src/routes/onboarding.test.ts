import { describe, expect, it } from 'vitest';
import { buildBootstrapPrompt } from './onboarding.js';

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
