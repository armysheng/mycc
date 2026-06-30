const CLAUDE_ENV_KEYS = [
  'MYCC_AGENT_SDK_BASE_URL',
  'MYCC_AGENT_SDK_AUTH_TOKEN',
  'MYCC_AGENT_SDK_API_KEY',
  'MYCC_CLAUDE_BASE_URL',
  'MYCC_CLAUDE_AUTH_TOKEN',
  'MYCC_CLAUDE_API_KEY',
  'MYCC_CCR_BASE_URL',
  'MYCC_CCR_AUTH_TOKEN',
  'MYCC_CCR_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'VPS_ANTHROPIC_BASE_URL',
  'VPS_ANTHROPIC_AUTH_TOKEN',
] as const;

const REGISTRATION_ENV_KEYS = [
  'MYCC_REGISTRATION_MODE',
  'MYCC_REGISTRATION_ENABLED',
  'MYCC_REGISTRATION_INVITE_CODES',
] as const;

export function resetClaudeProviderEnvForTest() {
  for (const key of CLAUDE_ENV_KEYS) {
    delete process.env[key];
  }
}

export function resetRegistrationEnvForTest() {
  for (const key of REGISTRATION_ENV_KEYS) {
    delete process.env[key];
  }
}
