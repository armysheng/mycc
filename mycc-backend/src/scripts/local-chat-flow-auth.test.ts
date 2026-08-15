import { describe, expect, it } from 'vitest';
import { readAuthResult } from './local-chat-flow-auth.js';

describe('local chat flow auth parsing', () => {
  it('accepts the current auth response without the legacy linux_user field', () => {
    const result = readAuthResult({
      success: true,
      data: {
        token: 'jwt-token',
        user: {
          id: 42,
          email: 'smoke@example.test',
          is_initialized: false,
          assistant_name: '道友',
          plan: 'free',
        },
      },
    });

    expect(result).toEqual({
      token: 'jwt-token',
      user: {
        id: 42,
        email: 'smoke@example.test',
        is_initialized: false,
      },
    });
  });
});
