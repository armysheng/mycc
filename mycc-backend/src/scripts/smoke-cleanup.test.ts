import { describe, expect, it, vi } from 'vitest';
import { runSmokeWithCleanup } from './smoke-cleanup.js';

describe('smoke cleanup helper', () => {
  it('preserves the original smoke failure when cleanup also fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalError = new Error('original smoke failure');
    const cleanupError = new Error('cleanup failure');

    await expect(runSmokeWithCleanup({
      label: 'E2B smoke',
      run: async () => {
        throw originalError;
      },
      cleanup: async () => {
        throw cleanupError;
      },
    })).rejects.toBe(originalError);

    expect(consoleError).toHaveBeenCalledWith(
      '[cleanup:error] E2B smoke cleanup failed:',
      cleanupError,
    );
    consoleError.mockRestore();
  });

  it('fails the smoke when cleanup fails after a successful run', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanupError = new Error('cleanup failure');

    await expect(runSmokeWithCleanup({
      label: 'E2B smoke',
      run: async () => undefined,
      cleanup: async () => {
        throw cleanupError;
      },
    })).rejects.toBe(cleanupError);

    expect(consoleError).toHaveBeenCalledWith(
      '[cleanup:error] E2B smoke cleanup failed:',
      cleanupError,
    );
    consoleError.mockRestore();
  });
});
