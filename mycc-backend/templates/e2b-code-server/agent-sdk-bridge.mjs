import { query } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const prompt = Buffer.from(process.env.MYCC_AGENT_PROMPT_B64 || '', 'base64').toString('utf8');
const allowedTools = (process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS)
  .split(',')
  .map((tool) => tool.trim())
  .filter(Boolean);
const permissionMode = (process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'dontAsk').trim();

const options = {
  allowedTools,
  cwd: process.env.MYCC_AGENT_WORKSPACE_CWD || process.cwd(),
  env: {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/e2b-agent-sdk-runtime',
  },
  includePartialMessages: process.env.MYCC_AGENT_SDK_PARTIAL_MESSAGES === 'true',
  model: process.env.MYCC_E2B_AGENT_SDK_MODEL || DEFAULT_MODEL,
  permissionMode,
  settingSources: [],
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    excludeDynamicSections: true,
  },
};

if (permissionMode === 'bypassPermissions') {
  options.allowDangerouslySkipPermissions = true;
}

if (process.env.MYCC_AGENT_SESSION_ID) {
  options.resume = process.env.MYCC_AGENT_SESSION_ID;
}

for await (const message of query({ prompt, options })) {
  console.log(JSON.stringify(message));
}
