import { readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
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

const request = readRunnerRequest();
const prompt = readPrompt(request);
const images = readImages(request);
const execution = request?.execution || {};
const allowedTools = readAllowedTools(execution);
const permissionMode = readString(
  execution.permissionMode,
  process.env.MYCC_AGENT_SDK_PERMISSION_MODE || 'bypassPermissions',
);

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
  model: readString(execution.model, process.env.MYCC_E2B_AGENT_SDK_MODEL || DEFAULT_MODEL),
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
