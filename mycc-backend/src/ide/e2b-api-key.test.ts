import { describe, expect, it } from 'vitest';
import { isValidE2bApiKey, requireE2bApiKey, resolveE2bApiKey } from './e2b-api-key.js';

describe('E2B API key helpers', () => {
  it('prefers the MYCC-specific key', () => {
    expect(resolveE2bApiKey({
      E2B_API_KEY: 'e2b_cafebabe',
      MYCC_E2B_API_KEY: 'e2b_deadbeef',
    })).toBe('e2b_deadbeef');
  });

  it('falls back to the generic E2B key', () => {
    expect(resolveE2bApiKey({
      E2B_API_KEY: 'e2b_cafebabe',
      MYCC_E2B_API_KEY: '',
    })).toBe('e2b_cafebabe');
  });

  it('throws a clear error when neither key is configured', () => {
    expect(() => requireE2bApiKey({}))
      .toThrow('MYCC_E2B_API_KEY or E2B_API_KEY is required');
  });

  it('validates the E2B SDK key format before calling E2B', () => {
    expect(isValidE2bApiKey('e2b_deadbeef')).toBe(true);
    expect(isValidE2bApiKey('e2b_liveKey-ABC_123')).toBe(true);
    expect(isValidE2bApiKey('not-an-e2b-key')).toBe(false);
    expect(() => requireE2bApiKey({ E2B_API_KEY: 'not-an-e2b-key' }))
      .toThrow('must use the E2B API key format');
  });
});
