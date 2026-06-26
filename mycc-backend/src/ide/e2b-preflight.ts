import {
  describeClaudeProviderEnv,
  resolveClaudeProviderEnv,
  type ClaudeProviderEnvDescription,
} from '../agent-runtime/claude-env.js';
import { isValidE2bApiKey, resolveE2bApiKey } from './e2b-api-key.js';

export type E2bPreflightStatus = 'ok' | 'warn' | 'error' | 'skip';

export type E2bPreflightCheck = {
  id: string;
  label: string;
  status: E2bPreflightStatus;
  message: string;
  action?: string;
};

export type E2bPreflightReport = {
  ok: boolean;
  checks: E2bPreflightCheck[];
};

export type E2bPreflightOptions = {
  env?: NodeJS.ProcessEnv;
  templateExists?: (templateName: string, apiKey: string) => Promise<boolean>;
};

export const DEFAULT_E2B_AGENT_TEMPLATE_NAME = 'mycc-assistant-sandbox-dev';

export type E2bPreflightReadyResult = {
  apiKey: string;
  templateName: string;
  report: E2bPreflightReport;
};

export class E2bAgentPreflightError extends Error {
  readonly report: E2bPreflightReport;

  constructor(report: E2bPreflightReport) {
    super(formatE2bAgentPreflightReport(report));
    this.name = 'E2bAgentPreflightError';
    this.report = report;
  }
}

export async function buildE2bAgentPreflightReport(
  options: E2bPreflightOptions = {},
): Promise<E2bPreflightReport> {
  const env = options.env ?? process.env;
  const checks: E2bPreflightCheck[] = [];
  const apiKey = resolveE2bApiKey(env);
  const apiKeyValid = Boolean(apiKey && isValidE2bApiKey(apiKey));
  const configuredTemplateName = env.MYCC_E2B_TEMPLATE?.trim();
  const templateName = configuredTemplateName || DEFAULT_E2B_AGENT_TEMPLATE_NAME;
  const claudeProvider = describeClaudeProviderEnv(env);

  checks.push(checkE2bApiKey(apiKey));
  checks.push(checkRuntime(env));
  checks.push(checkIdeProvider(env));
  checks.push(checkWorkspaceProvider(env));
  checks.push(checkPublicTraffic(env));
  checks.push(checkClaudeProvider(env, claudeProvider));
  checks.push(checkClaudeProviderConsistency(claudeProvider));
  checks.push(checkGlobalOpenAiEnv(env));
  checks.push(await checkE2bTemplateExists({
    apiKey,
    apiKeyValid,
    templateExists: options.templateExists,
    templateName,
  }));

  return {
    ok: checks.every((check) => check.status !== 'error'),
    checks,
  };
}

export async function assertE2bAgentPreflightReady(
  options: E2bPreflightOptions = {},
): Promise<E2bPreflightReadyResult> {
  const env = options.env ?? process.env;
  const report = await buildE2bAgentPreflightReport(options);
  if (!report.ok) {
    throw new E2bAgentPreflightError(report);
  }

  const apiKey = resolveE2bApiKey(env);
  if (!apiKey) {
    throw new E2bAgentPreflightError(report);
  }

  return {
    apiKey,
    templateName: env.MYCC_E2B_TEMPLATE?.trim() || DEFAULT_E2B_AGENT_TEMPLATE_NAME,
    report,
  };
}

export function formatE2bAgentPreflightReport(report: E2bPreflightReport): string {
  const lines = [
    `E2B Agent preflight: ${report.ok ? 'ready' : 'needs attention'}`,
    ...report.checks.map(formatCheck),
  ];
  return lines.join('\n');
}

function checkE2bApiKey(apiKey: string | undefined): E2bPreflightCheck {
  if (!apiKey) {
    return {
      id: 'e2b-api-key',
      label: 'E2B API key',
      status: 'error',
      message: 'Missing MYCC_E2B_API_KEY or E2B_API_KEY.',
      action: 'Create an E2B API key in the E2B dashboard and set MYCC_E2B_API_KEY=e2b_<token>.',
    };
  }
  if (!isValidE2bApiKey(apiKey)) {
    return {
      id: 'e2b-api-key',
      label: 'E2B API key',
      status: 'error',
      message: 'Configured E2B key does not match the e2b_<token> prefix format.',
      action: 'Replace MYCC_E2B_API_KEY or E2B_API_KEY with a current E2B dashboard key.',
    };
  }
  return {
    id: 'e2b-api-key',
    label: 'E2B API key',
    status: 'ok',
    message: 'Configured via MYCC_E2B_API_KEY or E2B_API_KEY.',
  };
}

function checkRuntime(env: NodeJS.ProcessEnv): E2bPreflightCheck {
  const runtime = (env.MYCC_AGENT_RUNTIME || '').trim();
  if (runtime === 'e2b-claude-agent-sdk') {
    return {
      id: 'agent-runtime',
      label: 'Agent runtime',
      status: 'ok',
      message: 'MYCC_AGENT_RUNTIME is set to e2b-claude-agent-sdk.',
    };
  }
  return {
    id: 'agent-runtime',
    label: 'Agent runtime',
    status: 'warn',
    message: runtime
      ? `MYCC_AGENT_RUNTIME is ${runtime}; tonight's target runtime is e2b-claude-agent-sdk.`
      : 'MYCC_AGENT_RUNTIME is not set; production default remains remote-claude.',
    action: 'Set MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk before product-path verification.',
  };
}

function checkIdeProvider(env: NodeJS.ProcessEnv): E2bPreflightCheck {
  if ((env.MYCC_IDE_PROVIDER || '').trim() === 'e2b') {
    return {
      id: 'ide-provider',
      label: 'Remote IDE provider',
      status: 'ok',
      message: 'MYCC_IDE_PROVIDER=e2b.',
    };
  }
  return {
    id: 'ide-provider',
    label: 'Remote IDE provider',
    status: 'warn',
    message: 'MYCC_IDE_PROVIDER is not e2b.',
    action: 'Set MYCC_IDE_PROVIDER=e2b when verifying the code-server workspace path.',
  };
}

function checkWorkspaceProvider(env: NodeJS.ProcessEnv): E2bPreflightCheck {
  if ((env.MYCC_WORKSPACE_PROVIDER || '').trim() === 'e2b') {
    return {
      id: 'workspace-provider',
      label: 'Workspace API provider',
      status: 'ok',
      message: 'MYCC_WORKSPACE_PROVIDER=e2b.',
    };
  }
  return {
    id: 'workspace-provider',
    label: 'Workspace API provider',
    status: 'warn',
    message: 'Workspace API will not use the E2B IDE session.',
    action: 'Set MYCC_WORKSPACE_PROVIDER=e2b when validating file tree/read/write against the E2B sandbox.',
  };
}

function checkPublicTraffic(env: NodeJS.ProcessEnv): E2bPreflightCheck {
  if ((env.MYCC_E2B_ALLOW_PUBLIC_TRAFFIC || '').trim() === 'true') {
    return {
      id: 'public-traffic',
      label: 'E2B public traffic',
      status: 'error',
      message: 'MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=true is unsafe for product IDE sessions.',
      action: 'Set MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false and expose code-server only through the MyCC proxy.',
    };
  }
  return {
    id: 'public-traffic',
    label: 'E2B public traffic',
    status: 'ok',
    message: 'Public E2B host exposure is not enabled.',
  };
}

function checkClaudeProvider(
  env: NodeJS.ProcessEnv,
  description: ClaudeProviderEnvDescription,
): E2bPreflightCheck {
  const resolvedEnv = resolveClaudeProviderEnv(env);
  if (resolvedEnv.ANTHROPIC_AUTH_TOKEN || resolvedEnv.ANTHROPIC_API_KEY || description.credentialConfigured) {
    return {
      id: 'claude-provider',
      label: 'Claude provider credential',
      status: 'ok',
      message: `Credential source is ${description.credentialSource ?? 'configured'}.`,
    };
  }
  return {
    id: 'claude-provider',
    label: 'Claude provider credential',
    status: 'error',
    message: 'No Claude credential is configured.',
    action: 'Set MYCC_CLAUDE_AUTH_TOKEN or MYCC_CLAUDE_API_KEY for direct Claude-compatible access; CCR variables are optional routing fallbacks.',
  };
}

function checkClaudeProviderConsistency(description: ClaudeProviderEnvDescription): E2bPreflightCheck {
  const base = description.baseUrlSource;
  const credential = description.credentialSource;
  if (base?.startsWith('VPS_') && credential && !credential.startsWith('VPS_')) {
    return {
      id: 'claude-provider-consistency',
      label: 'Claude provider consistency',
      status: 'warn',
      message: `Base URL source is ${base}, but credential source is ${credential}.`,
      action: 'Prefer one explicit pair: MYCC_CLAUDE_BASE_URL + MYCC_CLAUDE_AUTH_TOKEN for direct access, or MYCC_CCR_BASE_URL + MYCC_CCR_AUTH_TOKEN when intentionally routing through CCR.',
    };
  }
  if (credential?.startsWith('VPS_') && base && !base.startsWith('VPS_')) {
    return {
      id: 'claude-provider-consistency',
      label: 'Claude provider consistency',
      status: 'warn',
      message: `Credential source is ${credential}, but base URL source is ${base}.`,
      action: 'Use matching Claude provider env pairs to avoid auth mismatches.',
    };
  }
  return {
    id: 'claude-provider-consistency',
    label: 'Claude provider consistency',
    status: 'ok',
    message: 'Claude base URL and credential sources look consistent enough for preflight.',
  };
}

function checkGlobalOpenAiEnv(env: NodeJS.ProcessEnv): E2bPreflightCheck {
  const hasGlobalOpenAi = Boolean(env.OPENAI_BASE_URL?.trim() || env.OPENAI_API_KEY?.trim());
  if (!hasGlobalOpenAi) {
    return {
      id: 'global-openai-env',
      label: 'Global OpenAI env',
      status: 'ok',
      message: 'No global OPENAI_BASE_URL or OPENAI_API_KEY will be forwarded to Claude runtime.',
    };
  }
  return {
    id: 'global-openai-env',
    label: 'Global OpenAI env',
    status: 'warn',
    message: 'Global OPENAI_BASE_URL or OPENAI_API_KEY is set but ignored by MyCC Claude runtime.',
    action: 'If CCR needs OpenAI-compatible upstream credentials, configure OPENAI_* inside the CCR router process, not MyCC.',
  };
}

async function checkE2bTemplateExists(params: {
  apiKey: string | undefined;
  apiKeyValid: boolean;
  templateExists: E2bPreflightOptions['templateExists'];
  templateName: string;
}): Promise<E2bPreflightCheck> {
  if (!params.apiKey || !params.apiKeyValid) {
    return {
      id: 'e2b-template-exists',
      label: 'E2B template',
      status: 'skip',
      message: `Skipped remote template check for ${params.templateName} because the E2B API key is not usable.`,
      action: 'Configure MYCC_E2B_API_KEY first, then rerun the doctor.',
    };
  }
  if (!params.templateExists) {
    return {
      id: 'e2b-template-exists',
      label: 'E2B template',
      status: 'skip',
      message: `Remote template existence for ${params.templateName} was not checked.`,
      action: 'Run npm run doctor:e2b-agent to query E2B for the template.',
    };
  }

  let exists: boolean;
  try {
    exists = await params.templateExists(params.templateName, params.apiKey);
  } catch {
    return {
      id: 'e2b-template-exists',
      label: 'E2B template',
      status: 'error',
      message: `Remote E2B template lookup failed for ${params.templateName}.`,
      action: 'Verify the E2B API key, network access, and template permissions, then rerun the doctor.',
    };
  }
  if (!exists) {
    return {
      id: 'e2b-template-exists',
      label: 'E2B template',
      status: 'error',
      message: `E2B template does not exist: ${params.templateName}.`,
      action: 'Create/build the assistant template from mycc-sandbox, or use the legacy mycc-backend/templates/e2b-code-server path only for code-server-only checks.',
    };
  }

  return {
    id: 'e2b-template-exists',
    label: 'E2B template',
    status: 'ok',
    message: `E2B template exists: ${params.templateName}.`,
  };
}

function formatCheck(check: E2bPreflightCheck): string {
  const action = check.action ? ` Next: ${check.action}` : '';
  return `[${check.status}] ${check.label}: ${check.message}${action}`;
}
