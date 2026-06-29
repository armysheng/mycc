import { describe, expect, it } from 'vitest';
import { parseCorsOrigins } from './cors.js';

describe('parseCorsOrigins', () => {
  it('returns local development defaults when MYCC_CORS_ORIGINS is not configured', () => {
    expect(parseCorsOrigins({})).toEqual([
      'http://localhost:3001',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
    ]);
  });

  it.each(['', '   ', ' , , '])(
    'returns local development defaults when MYCC_CORS_ORIGINS is only empty entries: %j',
    (configuredOrigins) => {
      expect(parseCorsOrigins({ MYCC_CORS_ORIGINS: configuredOrigins })).toEqual([
        'http://localhost:3001',
        'http://localhost:3000',
        'http://127.0.0.1:3001',
      ]);
    },
  );

  it('parses comma-separated origins from MYCC_CORS_ORIGINS', () => {
    expect(
      parseCorsOrigins({
        MYCC_CORS_ORIGINS: ' https://app.example.com,https://admin.example.com, , http://localhost:5173 ',
      }),
    ).toEqual(['https://app.example.com', 'https://admin.example.com', 'http://localhost:5173']);
  });

  it('rejects wildcard origins because credentials are enabled', () => {
    expect(() =>
      parseCorsOrigins({
        MYCC_CORS_ORIGINS: 'https://app.example.com, *',
      }),
    ).toThrow(/MYCC_CORS_ORIGINS.*wildcard/i);
  });
});
