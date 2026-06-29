export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3001',
];

export function parseCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredOrigins = env.MYCC_CORS_ORIGINS;
  if (configuredOrigins === undefined) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  const origins = configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  if (origins.includes('*')) {
    throw new Error('MYCC_CORS_ORIGINS cannot include wildcard "*" because CORS credentials are enabled');
  }

  return origins;
}
