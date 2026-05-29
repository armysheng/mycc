type ClaudeProviderEnv = Partial<{
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}>;

type ClaudeCredentialEnv = {
  source: string;
  target: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';
};

const BASE_URL_ENV_KEYS = [
  'MYCC_CCR_BASE_URL',
  'MYCC_CLAUDE_BASE_URL',
  'MYCC_AGENT_SDK_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'VPS_ANTHROPIC_BASE_URL',
];

const CREDENTIAL_ENV_KEYS: ClaudeCredentialEnv[] = [
  { source: 'MYCC_CCR_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_CCR_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'MYCC_CLAUDE_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_CLAUDE_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'MYCC_AGENT_SDK_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_AGENT_SDK_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'ANTHROPIC_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'ANTHROPIC_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'VPS_ANTHROPIC_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
];

const CLAUDE_PROVIDER_ENV_KEYS = new Set([
  ...BASE_URL_ENV_KEYS,
  ...CREDENTIAL_ENV_KEYS.map((credential) => credential.source),
]);

export function resolveClaudeProviderEnv(env: NodeJS.ProcessEnv = process.env): ClaudeProviderEnv {
  const baseUrl = pickFirstEnv(env, BASE_URL_ENV_KEYS);
  const credential = pickFirstCredentialEnv(env);

  return {
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    ...(credential ? { [credential.target]: credential.value } : {}),
  };
}

export function omitClaudeProviderEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv = { ...env };
  for (const key of CLAUDE_PROVIDER_ENV_KEYS) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}

function pickFirstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function pickFirstCredentialEnv(
  env: NodeJS.ProcessEnv,
): { target: ClaudeCredentialEnv['target']; value: string } | undefined {
  for (const credential of CREDENTIAL_ENV_KEYS) {
    const value = env[credential.source]?.trim();
    if (value) {
      return { target: credential.target, value };
    }
  }
  return undefined;
}
