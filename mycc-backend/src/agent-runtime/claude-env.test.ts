import { describe, expect, it } from 'vitest';
import { omitClaudeProviderEnv, resolveClaudeProviderEnv } from './claude-env.js';

describe('Claude provider env resolver', () => {
  it('prefers CCR base URL and credential aliases over all fallbacks', () => {
    const result = resolveClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test',
      MYCC_CLAUDE_BASE_URL: 'https://claude-proxy.example.test',
      MYCC_AGENT_SDK_BASE_URL: 'https://legacy-agent-sdk.example.test',
      ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
      VPS_ANTHROPIC_BASE_URL: 'https://vps.example.test',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
      MYCC_CCR_API_KEY: 'ccr-api-key',
      ANTHROPIC_API_KEY: 'stale-anthropic-key',
    });

    expect(result).toEqual({
      ANTHROPIC_BASE_URL: 'https://ccr.example.test',
      ANTHROPIC_AUTH_TOKEN: 'ccr-token',
    });
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('falls back through MYCC_CLAUDE, legacy Agent SDK, Anthropic, and VPS base URLs', () => {
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

  it('removes only Claude provider aliases before injecting resolved values', () => {
    expect(omitClaudeProviderEnv({
      MYCC_CCR_BASE_URL: 'https://ccr.example.test',
      MYCC_CCR_AUTH_TOKEN: 'ccr-token',
      MYCC_CLAUDE_API_KEY: 'claude-api-key',
      ANTHROPIC_API_KEY: 'anthropic-api-key',
      VPS_ANTHROPIC_AUTH_TOKEN: 'vps-auth-token',
      OPENAI_API_KEY: 'openai-key',
      OTHER_ENV: 'keep-me',
    })).toEqual({
      OPENAI_API_KEY: 'openai-key',
      OTHER_ENV: 'keep-me',
    });
  });
});
