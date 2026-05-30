export function resolveE2bApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MYCC_E2B_API_KEY?.trim() || env.E2B_API_KEY?.trim() || undefined;
}

export function requireE2bApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = resolveE2bApiKey(env);
  if (!apiKey) {
    throw new Error('MYCC_E2B_API_KEY or E2B_API_KEY is required');
  }
  return apiKey;
}
