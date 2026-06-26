type ClaudeProviderEnv = Partial<{
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}>;

type ClaudeCredentialEnv = {
  source: string;
  target: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';
};

export type ClaudeProviderKind = 'mycc-claude' | 'ccr' | 'custom' | 'anthropic' | 'vps' | 'none';

export type ClaudeProviderEnvDescription = {
  provider: ClaudeProviderKind;
  baseUrlConfigured: boolean;
  baseUrlSource?: string;
  credentialConfigured: boolean;
  credentialSource?: string;
  credentialTarget?: ClaudeCredentialEnv['target'];
};

const BASE_URL_ENV_KEYS = [
  'MYCC_CLAUDE_BASE_URL',
  'MYCC_CCR_BASE_URL',
  'MYCC_AGENT_SDK_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'VPS_ANTHROPIC_BASE_URL',
];

const CREDENTIAL_ENV_KEYS: ClaudeCredentialEnv[] = [
  { source: 'MYCC_CLAUDE_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_CLAUDE_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'MYCC_CCR_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_CCR_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'MYCC_AGENT_SDK_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'MYCC_AGENT_SDK_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'ANTHROPIC_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
  { source: 'ANTHROPIC_API_KEY', target: 'ANTHROPIC_API_KEY' },
  { source: 'VPS_ANTHROPIC_AUTH_TOKEN', target: 'ANTHROPIC_AUTH_TOKEN' },
];

const CLAUDE_PROVIDER_ENV_KEYS = new Set([
  ...BASE_URL_ENV_KEYS,
  ...CREDENTIAL_ENV_KEYS.map((credential) => credential.source),
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
]);

export function resolveClaudeProviderEnv(env: NodeJS.ProcessEnv = process.env): ClaudeProviderEnv {
  const baseUrl = pickFirstEnvEntry(env, BASE_URL_ENV_KEYS);
  const credential = pickFirstCredentialEnv(env);

  return {
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl.value } : {}),
    ...(credential ? { [credential.target]: credential.value } : {}),
  };
}

export function describeClaudeProviderEnv(env: NodeJS.ProcessEnv = process.env): ClaudeProviderEnvDescription {
  const baseUrl = pickFirstEnvEntry(env, BASE_URL_ENV_KEYS);
  const credential = pickFirstCredentialEnv(env);
  const provider = classifyProvider(baseUrl?.source, credential?.source);

  return {
    provider,
    baseUrlConfigured: Boolean(baseUrl),
    ...(baseUrl ? { baseUrlSource: baseUrl.source } : {}),
    credentialConfigured: Boolean(credential),
    ...(credential ? {
      credentialSource: credential.source,
      credentialTarget: credential.target,
    } : {}),
  };
}

export function omitClaudeProviderEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv = { ...env };
  for (const key of CLAUDE_PROVIDER_ENV_KEYS) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}

function pickFirstEnvEntry(
  env: NodeJS.ProcessEnv,
  keys: string[],
): { source: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { source: key, value };
  }
  return undefined;
}

function pickFirstCredentialEnv(
  env: NodeJS.ProcessEnv,
): { source: string; target: ClaudeCredentialEnv['target']; value: string } | undefined {
  for (const credential of CREDENTIAL_ENV_KEYS) {
    const value = env[credential.source]?.trim();
    if (value) {
      return { source: credential.source, target: credential.target, value };
    }
  }
  return undefined;
}

function classifyProvider(
  baseUrlSource: string | undefined,
  credentialSource: string | undefined,
): ClaudeProviderKind {
  const source = baseUrlSource || credentialSource;
  if (!source) return 'none';
  if (source.startsWith('MYCC_CLAUDE_')) return 'mycc-claude';
  if (source.startsWith('MYCC_CCR_')) return 'ccr';
  if (source.startsWith('VPS_')) return 'vps';
  if (source.startsWith('ANTHROPIC_')) return 'anthropic';
  return 'custom';
}
