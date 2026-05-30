export function resolveE2bApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MYCC_E2B_API_KEY?.trim() || env.E2B_API_KEY?.trim() || undefined;
}

export function requireE2bApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = resolveE2bApiKey(env);
  if (!apiKey) {
    throw new Error('MYCC_E2B_API_KEY or E2B_API_KEY is required');
  }
  if (!isValidE2bApiKey(apiKey)) {
    throw new Error('MYCC_E2B_API_KEY or E2B_API_KEY must use the E2B API key format: e2b_<hex>');
  }
  return apiKey;
}

export function isValidE2bApiKey(apiKey: string): boolean {
  return /^e2b_[0-9a-fA-F]+$/.test(apiKey.trim());
}
