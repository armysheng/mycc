#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Sandbox } from 'e2b';

const root = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.resolve(root, '..', 'mycc-backend', '.env'));

const templateName = process.env.MYCC_SANDBOX_TEMPLATE || 'mycc-assistant-sandbox-dev';
const apiKey = process.env.MYCC_E2B_API_KEY || process.env.E2B_API_KEY;

if (!apiKey) {
  console.error('[error] Missing MYCC_E2B_API_KEY or E2B_API_KEY. Value hidden when present.');
  process.exit(1);
}

let sandbox;

try {
  console.log('[run] create-sandbox');
  sandbox = await Sandbox.create(templateName, {
    apiKey,
    timeoutMs: 10 * 60 * 1000,
    metadata: {
      app: 'mycc',
      capability: 'agent-browser-skill-smoke',
    },
    network: {
      allowPublicTraffic: false,
    },
  });
  console.log('[ok] create-sandbox');

  const result = await runAgentBrowserTask();
  const events = parseEvents(result.stdout);
  const sawDesktopBrowserToolUse = events.some(eventContainsDesktopBrowserToolUse);
  const sawBaiduTarget = events.some(eventContainsBaiduTarget);
  const toolUseCount = events
    .flatMap((event) => Array.isArray(event?.message?.content) ? event.message.content : [])
    .filter((item) => item?.type === 'tool_use')
    .length;
  const chromium = await runForeground(
    'pgrep -af chromium >/dev/null && echo running || echo missing',
    { timeoutMs: 10_000 },
  );

  const ok = result.exitCode === 0
    && sawDesktopBrowserToolUse
    && sawBaiduTarget
    && chromium.stdout.includes('running');

  console.log(JSON.stringify({
    ok,
    agentExitCode: result.exitCode,
    eventCount: events.length,
    toolUseCount,
    sawDesktopBrowserToolUse,
    sawBaiduTarget,
    chromium: chromium.stdout.trim(),
    runError: result.error ? sanitize(result.error) : '',
    lastEvents: summarizeEvents(events).slice(-5),
    stderrTail: sanitize(result.stderr).split(/\r?\n/).filter(Boolean).slice(-3),
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[error] ${sanitize(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
} finally {
  if (sandbox) {
    try {
      await sandbox.kill();
      console.log('[ok] cleanup');
    } catch {
      console.error('[warn] cleanup failed');
      process.exitCode = process.exitCode || 1;
    }
  }
}

async function runAgentBrowserTask() {
  const prompt = [
    '帮我代开 baidu 的首页。',
    '请使用可见的 GNU 桌面浏览器完成，不要用 curl 代替。',
    '完成后只用一句话说明浏览器已打开，不要输出环境变量、令牌或内部服务地址。',
  ].join('\n');
  console.log('[run] sandbox-agent-browser-task');
  return runForeground('cd /opt/mycc-agent-runtime && node bridge.mjs', {
    timeoutMs: 180_000,
    envs: {
      ...buildClaudeProviderEnv(),
      CLAUDE_CONFIG_DIR: '/home/mycc/.mycc/claude',
      HOME: '/home/mycc/.mycc/home',
      XDG_CONFIG_HOME: '/home/mycc/.mycc/home/.config',
      XDG_DATA_HOME: '/home/mycc/.mycc/home/.local/share',
      MYCC_AGENT_PROMPT_B64: Buffer.from(prompt, 'utf8').toString('base64'),
      MYCC_AGENT_SDK_ALLOWED_TOOLS: 'Read,Glob,Grep,Bash,Edit,Write',
      MYCC_AGENT_SDK_PERMISSION_MODE: 'bypassPermissions',
      MYCC_AGENT_SDK_SETTING_SOURCES: 'user,project',
      MYCC_AGENT_SDK_SKILLS: 'all',
      MYCC_AGENT_WORKSPACE_CWD: '/home/mycc/workspace',
      MYCC_E2B_AGENT_SDK_MODEL: normalizeClaudeModelId(process.env.MYCC_E2B_AGENT_SDK_MODEL
        || process.env.MYCC_AGENT_SDK_MODEL
        || process.env.VPS_CLAUDE_MODEL
        || process.env.CLAUDE_MODEL
        || 'claude-opus-4-7'),
    },
  });
}

function normalizeClaudeModelId(model) {
  return model === 'claude-opus-4.7' ? 'claude-opus-4-7' : model;
}

async function runForeground(command, options = {}) {
  let stdout = '';
  let stderr = '';

  try {
    const result = await sandbox.commands.run(command, {
      ...options,
      background: false,
      cwd: '/home/mycc/workspace',
      onStdout: (data) => {
        stdout += data;
      },
      onStderr: (data) => {
        stderr += data;
      },
    });

    return {
      ...result,
      stdout: result.stdout || stdout,
      stderr: result.stderr || stderr,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout,
      stderr,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function eventContainsDesktopBrowserToolUse(event) {
  const content = event?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((item) => (
    item?.type === 'tool_use'
    && item?.name === 'Bash'
    && /\b(chromium|chromium-browser|google-chrome|browser-use|browser_use|playwright|exo-open|mycc-browser|x-www-browser)\b|\/opt\/mycc\/browser-agent/i.test(String(item?.input?.command || ''))
  ));
}

function eventContainsBaiduTarget(event) {
  const content = event?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((item) => (
    item?.type === 'tool_use'
    && item?.name === 'Bash'
    && /(baidu|baidu\.com|百度)/i.test(String(item?.input?.command || ''))
  ));
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON stdout; the bridge is expected to emit SDK JSON lines.
    }
  }
  return events;
}

function summarizeEvents(events) {
  return events.map((event) => {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    const toolUses = content
      .filter((item) => item?.type === 'tool_use')
      .map((item) => ({
        name: String(item?.name || ''),
        command: sanitize(String(item?.input?.command || '')).slice(0, 200),
      }));
    const toolResults = content
      .filter((item) => item?.type === 'tool_result')
      .map((item) => ({
        isError: Boolean(item?.is_error),
        content: sanitize(String(item?.content || '')).slice(0, 200),
      }));

    return {
      type: String(event?.type || ''),
      subtype: String(event?.subtype || ''),
      isError: Boolean(event?.is_error),
      toolUses,
      toolResults,
    };
  });
}

function buildClaudeProviderEnv() {
  const baseUrl = firstEnv([
    'MYCC_CCR_BASE_URL',
    'MYCC_CLAUDE_BASE_URL',
    'MYCC_AGENT_SDK_BASE_URL',
    'ANTHROPIC_BASE_URL',
    'VPS_ANTHROPIC_BASE_URL',
  ]);
  const authToken = firstEnv([
    'MYCC_CCR_AUTH_TOKEN',
    'MYCC_CLAUDE_AUTH_TOKEN',
    'MYCC_AGENT_SDK_AUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'VPS_ANTHROPIC_AUTH_TOKEN',
  ]);
  const apiCredential = firstEnv([
    'MYCC_CCR_API_KEY',
    'MYCC_CLAUDE_API_KEY',
    'MYCC_AGENT_SDK_API_KEY',
    'ANTHROPIC_API_KEY',
  ]);

  return {
    ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
    ...(authToken ? { ANTHROPIC_AUTH_TOKEN: authToken } : apiCredential ? { ANTHROPIC_API_KEY: apiCredential } : {}),
  };
}

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function sanitize(value) {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, '[redacted-url]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|e2b_[A-Za-z0-9_-]{8,}|claude_[A-Za-z0-9_-]{8,}|anthropic_[A-Za-z0-9_-]{8,})\b/g, '[redacted-secret]')
    .replace(/(token|key|secret|authorization)(\s*[=:]\s*)[^\s]+/gi, '$1$2[redacted]');
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
