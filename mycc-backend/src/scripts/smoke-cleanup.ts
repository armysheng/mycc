export type SmokeCleanupOptions = {
  label: string;
  run: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export async function runSmokeWithCleanup(options: SmokeCleanupOptions): Promise<void> {
  let runError: unknown;

  try {
    await options.run();
  } catch (error) {
    runError = error;
  }

  try {
    await options.cleanup();
  } catch (cleanupError) {
    console.error(`[cleanup:error] ${options.label} cleanup failed:`, cleanupError);
    if (!runError) throw cleanupError;
  }

  if (runError) throw runError;
}
