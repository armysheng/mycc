import { describe, expect, it } from 'vitest';
import { isLikelyStaleE2bSessionError } from './e2b-session-errors.js';

describe('E2B stale session error detection', () => {
  it('detects stale sandbox errors', () => {
    expect(isLikelyStaleE2bSessionError(new Error('sandbox not found'))).toBe(true);
    expect(isLikelyStaleE2bSessionError(new Error('404 sandbox does not exist'))).toBe(true);
    expect(isLikelyStaleE2bSessionError(new Error('sandbox was stopped'))).toBe(true);
  });

  it('does not treat generic execution failures as stale sessions', () => {
    expect(isLikelyStaleE2bSessionError(new Error('command timed out'))).toBe(false);
    expect(isLikelyStaleE2bSessionError(new Error('permission denied'))).toBe(false);
  });
});
