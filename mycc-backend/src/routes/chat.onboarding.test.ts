import { describe, expect, it } from 'vitest';
import { parseOnboardingBootstrapRequest } from './chat.js';

describe('parseOnboardingBootstrapRequest', () => {
  it('extracts assistant name from onboarding bootstrap prompt', () => {
    const message = [
      '你正在执行用户工作区首次初始化。请直接在文件系统中完成，不要只输出建议。',
      '2. 按以下信息个性化初始化：',
      '   - 助手名称：韩立',
      '   - 用户称呼：元婴',
    ].join('\n');
    expect(parseOnboardingBootstrapRequest(message)).toEqual({
      assistantName: '韩立',
    });
  });

  it('returns null for non-onboarding message', () => {
    expect(parseOnboardingBootstrapRequest('你好，今天天气怎么样')).toBeNull();
  });
});
