import { describe, expect, it } from 'vitest';
import { describeClaudeProviderEnv, omitClaudeProviderEnv, resolveClaudeProviderEnv } from './claude-env.js';

describe('Claude provider env resolver', () => {
  it('prefers direct MyCC Claude aliases over CCR and all fallbacks', () => {
    const result = resolveClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test',
      MYCC_CLAUDE_BASE_URL: 'https://claude-proxy.example.test',
      MYCC_AGENT_SDK_BASE_URL: 'https://legacy-agent-sdk.example.test',
      ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
      VPS_ANTHROPIC_BASE_URL: 'https://vps.example.test',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
      MYCC_CLAUDE_AUTH_TOKEN: 'claude-token',
      MYCC_CCR_API_KEY: 'ccr-api-key',
      ANTHROPIC_API_KEY: 'stale-anthropic-key',
    });

    expect(result).toEqual({
      ANTHROPIC_BASE_URL: 'https://claude-proxy.example.test',
      ANTHROPIC_AUTH_TOKEN: 'claude-token',
    });
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('falls back through CCR, legacy Agent SDK, Anthropic, and VPS base URLs', () => {
    expect(resolveClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test',
    })).toEqual({ ANTHROPIC_BASE_URL: 'https://ccr.example.test' });

    expect(resolveClaudeProviderEnv({
      MYCC_CLAUDE_BASE_URL: 'https://claude-proxy.example.test',
    })).toEqual({ ANTHROPIC_BASE_URL: 'https://claude-proxy.example.test' });

    expect(resolveClaudeProviderEnv({
      MYCC_AGENT_SDK_BASE_URL: 'https://legacy-agent-sdk.example.test',
    })).toEqual({ ANTHROPIC_BASE_URL: 'https://legacy-agent-sdk.example.test' });

    expect(resolveClaudeProviderEnv({
      ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
    })).toEqual({ ANTHROPIC_BASE_URL: 'https://anthropic.example.test' });

    expect(resolveClaudeProviderEnv({
      VPS_ANTHROPIC_BASE_URL: 'https://vps.example.test',
    })).toEqual({ ANTHROPIC_BASE_URL: 'https://vps.example.test' });
  });

  it('falls back through credential aliases while forwarding only the first usable credential', () => {
    expect(resolveClaudeProviderEnv({
      MYCC_CLAUDE_API_KEY: 'claude-api-key',
      ANTHROPIC_AUTH_TOKEN: 'stale-auth-token',
    })).toEqual({ ANTHROPIC_API_KEY: 'claude-api-key' });

    expect(resolveClaudeProviderEnv({
      MYCC_AGENT_SDK_AUTH_TOKEN: 'legacy-sdk-token',
      MYCC_AGENT_SDK_API_KEY: 'legacy-sdk-api-key',
    })).toEqual({ ANTHROPIC_AUTH_TOKEN: 'legacy-sdk-token' });

    expect(resolveClaudeProviderEnv({
      ANTHROPIC_API_KEY: 'anthropic-api-key',
      VPS_ANTHROPIC_AUTH_TOKEN: 'vps-auth-token',
    })).toEqual({ ANTHROPIC_API_KEY: 'anthropic-api-key' });

    expect(resolveClaudeProviderEnv({
      VPS_ANTHROPIC_AUTH_TOKEN: 'vps-auth-token',
    })).toEqual({ ANTHROPIC_AUTH_TOKEN: 'vps-auth-token' });
  });

  it('trims configured values and ignores blanks', () => {
    expect(resolveClaudeProviderEnv({
      MYCC_CCR_BASE_URL: '   ',
      MYCC_CLAUDE_BASE_URL: ' https://claude-proxy.example.test ',
      MYCC_CCR_AUTH_TOKEN: '',
      MYCC_CLAUDE_AUTH_TOKEN: ' claude-token ',
    })).toEqual({
      ANTHROPIC_BASE_URL: 'https://claude-proxy.example.test',
      ANTHROPIC_AUTH_TOKEN: 'claude-token',
    });
  });

  it('removes Claude provider aliases and global OpenAI credentials before injecting resolved values', () => {
    expect(omitClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
      MYCC_CLAUDE_API_KEY: 'claude-api-key',
      ANTHROPIC_API_KEY: 'anthropic-api-key',
      VPS_ANTHROPIC_AUTH_TOKEN: 'vps-auth-token',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://openai-compatible.example.test/v1',
      OTHER_ENV: 'keep-me',
    })).toEqual({
      OTHER_ENV: 'keep-me',
    });
  });

  it('describes CCR provider configuration without exposing URLs or credentials', () => {
    const description = describeClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
      ANTHROPIC_API_KEY: 'stale-anthropic-key',
    });

    expect(description).toEqual({
      provider: 'ccr',
      baseUrlConfigured: true,
      baseUrlSource: 'MYCC_CCR_BASE_URL',
      credentialConfigured: true,
      credentialSource: 'MYCC_CCR_AUTH_TOKEN',
      credentialTarget: 'ANTHROPIC_AUTH_TOKEN',
    });
    expect(JSON.stringify(description)).not.toContain('ccr-token');
    expect(JSON.stringify(description)).not.toContain('ccr.example.test');
    expect(JSON.stringify(description)).not.toContain('stale-anthropic-key');
  });

  it('describes direct MyCC Claude configuration without exposing URLs or credentials', () => {
    const description = describeClaudeProviderEnv({
      MYCC_CLAUDE_BASE_URL: 'https://zhuji.example.test/v1',
      MYCC_CLAUDE_AUTH_TOKEN: 'zhuji-token',
      MYCC_CCR_BASE_URL: 'https://ccr.example.test/v1',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
    });

    expect(description).toEqual({
      provider: 'mycc-claude',
      baseUrlConfigured: true,
      baseUrlSource: 'MYCC_CLAUDE_BASE_URL',
      credentialConfigured: true,
      credentialSource: 'MYCC_CLAUDE_AUTH_TOKEN',
      credentialTarget: 'ANTHROPIC_AUTH_TOKEN',
    });
    expect(JSON.stringify(description)).not.toContain('zhuji-token');
    expect(JSON.stringify(description)).not.toContain('zhuji.example.test');
    expect(JSON.stringify(description)).not.toContain('ccr-token');
  });
});
