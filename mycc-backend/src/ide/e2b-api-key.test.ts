import { describe, expect, it } from 'vitest';
import { requireE2bApiKey, resolveE2bApiKey } from './e2b-api-key.js';

describe('E2B API key helpers', () => {
  it('prefers the MYCC-specific key', () => {
    expect(resolveE2bApiKey({
      E2B_API_KEY: 'generic-key',
      MYCC_E2B_API_KEY: 'mycc-key',
    })).toBe('mycc-key');
  });

  it('falls back to the generic E2B key', () => {
    expect(resolveE2bApiKey({
      E2B_API_KEY: 'generic-key',
      MYCC_E2B_API_KEY: '',
    })).toBe('generic-key');
  });

  it('throws a clear error when neither key is configured', () => {
    expect(() => requireE2bApiKey({}))
      .toThrow('MYCC_E2B_API_KEY or E2B_API_KEY is required');
  });
});
