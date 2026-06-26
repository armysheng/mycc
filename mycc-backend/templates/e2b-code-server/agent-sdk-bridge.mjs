import { readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep,Bash,Edit,Write';
const DEFAULT_MODEL = 'claude-opus-4-7';
const MODEL_ALIASES = {
  'claude-opus-4.7': 'claude-opus-4-7',
};
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const SDK_ENV_DENYLIST = [
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
];
const DANGEROUS_BASH_PATTERNS = [
  {
    pattern: /\brm\s+-[^&|;]*r[^&|;]*f\s+(?:\/|\$HOME|~)(?:\s|$)/i,
    reason: 'recursive force delete against a root or home path',
  },
  {
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: 'host shutdown command',
  },
  {
    pattern: /\b(?:mkfs|fdisk|parted|diskutil)\b/i,
    reason: 'disk mutation command',
  },
  {
    pattern: /\bdd\s+if=.*\bof=\/dev\//i,
    reason: 'raw device write command',
  },
  {
    pattern: /\bchmod\s+-R\s+777\s+(?:\/|\$HOME|~)(?:\s|$)/i,
    reason: 'recursive world-writable permission change',
  },
  {
    pattern: /\bcurl\b[^|;&]*\|\s*(?:sh|bash)\b/i,
    reason: 'remote script pipe to shell',
  },
  {
    pattern: /\bwget\b[^|;&]*\|\s*(?:sh|bash)\b/i,
    reason: 'remote script pipe to shell',
  },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
    reason: 'fork bomb pattern',
  },
];

const request = readRunnerRequest();
const prompt = readPrompt(request);
const images = readImages(request);
const execution = request?.execution || {};
const allowedTools = readAllowedTools(execution);
const permissionMode = readString(
  execution.permissionMode,
  process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'bypassPermissions',
);
const settingSources = (process.env.MYCC_AGENT_SDK_SETTING_SOURCES || 'user,project')
  .split(',')
  .map((source) => source.trim())
  .filter(Boolean);
const skills = resolveSkillsOption(process.env.MYCC_AGENT_SDK_SKILLS || 'all');

const options = {
  allowedTools,
  cwd: readString(execution.cwd, process.env.MYCC_AGENT_WORKSPACE_CWD || process.cwd()),
  env: {
    ...buildSdkEnv(process.env),
    CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP || 'mycc-backend/e2b-agent-sdk-runtime',
  },
  includePartialMessages: typeof execution.includePartialMessages === 'boolean'
    ? execution.includePartialMessages
    : process.env.MYCC_AGENT_SDK_PARTIAL_MESSAGES === 'true',
  hooks: createMyccBridgeHooks(),
  includeHookEvents: process.env.MYCC_AGENT_SDK_INCLUDE_HOOK_EVENTS === 'true',
  model: normalizeModelId(readString(execution.model, process.env.MYCC_E2B_AGENT_SDK_MODEL || DEFAULT_MODEL)),
  permissionMode,
  settingSources,
  skills,
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    excludeDynamicSections: true,
  },
};

if (permissionMode === 'bypassPermissions') {
  options.allowDangerouslySkipPermissions = true;
}

const resumeSessionId = readString(execution.sessionId, process.env.MYCC_AGENT_SESSION_ID || '');
if (resumeSessionId) {
  options.resume = resumeSessionId;
}

for await (const message of query({ prompt: buildPrompt(prompt, images), options })) {
  console.log(JSON.stringify(message));
}

function buildPrompt(text, imageAttachments) {
  return (async function* promptStream() {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: imageAttachments.length === 0
          ? text
          : [
              { type: 'text', text },
              ...imageAttachments.map((image) => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mediaType,
                  data: image.data,
                },
              })),
            ],
      },
      parent_tool_use_id: null,
    };
  })();
}

function buildSdkEnv(env) {
  const cleanEnv = { ...env };
  for (const key of SDK_ENV_DENYLIST) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}

function createMyccBridgeHooks() {
  if (process.env.MYCC_AGENT_SDK_DANGEROUS_BASH_GUARD === 'false') return {};
  return {
    PreToolUse: [
      {
        hooks: [guardDangerousBashToolUse],
      },
    ],
  };
}

async function guardDangerousBashToolUse(input) {
  if (!input || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    return { continue: true };
  }
  const command = readBashCommand(input.tool_input);
  if (!command) return { continue: true };
  const matched = DANGEROUS_BASH_PATTERNS.find(({ pattern }) => pattern.test(command));
  if (!matched) return { continue: true };
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `MyCC blocked dangerous Bash command: ${matched.reason}.`,
    },
  };
}

function readBashCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return typeof input.command === 'string' ? input.command : null;
}

function normalizeModelId(model) {
  const trimmed = model.trim();
  return MODEL_ALIASES[trimmed] || trimmed;
}

function readRunnerRequest() {
  if (!process.env.MYCC_AGENT_REQUEST_FILE) return null;
  const parsed = JSON.parse(readFileSync(process.env.MYCC_AGENT_REQUEST_FILE, 'utf8'));
  if (
    !parsed ||
    parsed.kind !== 'mycc.agent-runner.request' ||
    parsed.version !== 1 ||
    parsed.runner !== 'claude-agent-sdk'
  ) {
    throw new Error('Unsupported MyCC agent runner request');
  }
  return parsed;
}

function readPrompt(runnerRequest) {
  if (runnerRequest) {
    if (typeof runnerRequest.input?.message !== 'string') {
      throw new Error('MyCC agent runner request input.message must be a string');
    }
    return runnerRequest.input.message;
  }
  if (process.env.MYCC_AGENT_PROMPT_FILE) {
    return readFileSync(process.env.MYCC_AGENT_PROMPT_FILE, 'utf8');
  }
  const encoded = readBase64Payload('MYCC_AGENT_PROMPT_B64', 'MYCC_AGENT_PROMPT_B64_FILE');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function readImages(runnerRequest) {
  if (runnerRequest && runnerRequest.input?.images !== undefined) {
    return normalizeImages(runnerRequest.input.images, 'MyCC agent runner request input.images');
  }
  if (process.env.MYCC_AGENT_IMAGES_FILE) {
    return decodeImagesJson(readFileSync(process.env.MYCC_AGENT_IMAGES_FILE, 'utf8'));
  }
  const encoded = readBase64Payload('MYCC_AGENT_IMAGES_B64', 'MYCC_AGENT_IMAGES_B64_FILE');
  if (!encoded) return [];
  return decodeImagesJson(Buffer.from(encoded, 'base64').toString('utf8'));
}

function readBase64Payload(envName, fileEnvName) {
  if (process.env[fileEnvName]) {
    return readFileSync(process.env[fileEnvName], 'utf8').trim();
  }
  return process.env[envName] || '';
}

function decodeImagesJson(raw) {
  const parsed = JSON.parse(raw);
  return normalizeImages(parsed, 'MYCC_AGENT_IMAGES');
}

function normalizeImages(parsed, label) {
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an image array`);
  }
  return parsed.map((image) => {
    if (
      !image ||
      typeof image.data !== 'string' ||
      typeof image.mediaType !== 'string'
    ) {
      throw new Error(`${label} contains an invalid image payload`);
    }
    return {
      data: image.data,
      mediaType: requireSupportedImageMediaType(image.mediaType),
    };
  });
}

function readAllowedTools(execution) {
  if (Array.isArray(execution.allowedTools)) {
    return execution.allowedTools
      .map((tool) => typeof tool === 'string' ? tool.trim() : '')
      .filter(Boolean);
  }
  return (process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS || DEFAULT_ALLOWED_TOOLS)
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function readString(value, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;
}

function requireSupportedImageMediaType(mediaType) {
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    return mediaType;
  }
  throw new Error(`Unsupported image media type: ${mediaType}`);
}

function resolveSkillsOption(raw) {
  const value = raw.trim();
  if (!value || value === 'all') return 'all';
  if (value === 'none' || value === '[]') return [];
  return value
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
}
