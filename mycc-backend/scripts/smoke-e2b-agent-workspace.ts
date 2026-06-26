import dotenv from 'dotenv';
import { Template } from 'e2b';
import type { AgentRuntime } from '../src/agent-runtime/types.js';
import { E2bClaudeAgentSdkRuntime } from '../src/agent-runtime/e2b-claude-agent-sdk-runtime.js';
import { E2bClaudeCliRuntime } from '../src/agent-runtime/e2b-claude-cli-runtime.js';
import {
  assertE2bAgentPreflightReady,
  DEFAULT_E2B_AGENT_TEMPLATE_NAME,
  E2bAgentPreflightError,
} from '../src/ide/e2b-preflight.js';
import { E2bSandboxProvider } from '../src/ide/e2b-provider.js';
import { assertE2bTemplateContract } from '../src/ide/e2b-template-contract.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../src/ide/session-store.js';
import { escapeShellArg } from '../src/utils/validation.js';

dotenv.config();

const TEMPLATE_NAME = process.env.MYCC_E2B_TEMPLATE?.trim() || DEFAULT_E2B_AGENT_TEMPLATE_NAME;
const SESSION_TTL_SECONDS = parsePositiveInteger(process.env.MYCC_IDE_SESSION_TTL_SECONDS, 900);
const SMOKE_USER_ID = parsePositiveInteger(process.env.MYCC_SMOKE_USER_ID, 42);
const CODE_SERVER_READY_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_SMOKE_CODE_SERVER_READY_TIMEOUT_MS, 120_000);
const PRODUCT_LINUX_USER = process.env.MYCC_SMOKE_LINUX_USER || 'tester';
const SANDBOX_LINUX_USER = process.env.MYCC_E2B_LINUX_USER || 'mycc';
const WORKSPACE_DIR = process.env.MYCC_E2B_WORKSPACE_DIR || `/home/${SANDBOX_LINUX_USER}/workspace`;
const MARKER = `mycc-e2b-agent-smoke-${Date.now()}`;
const IDE_MARKER_FILE = 'mycc-smoke-from-ide.txt';
const AGENT_READBACK_FILE = 'mycc-smoke-agent-readback.txt';
const AGENT_MARKER_FILE = 'mycc-smoke-from-agent.txt';
const AGENT_RUNTIME = process.env.MYCC_SMOKE_E2B_AGENT_RUNTIME || 'e2b-claude-cli';
const E2B_AGENT_SDK_SMOKE_ALLOWED_TOOLS = 'Read,Glob,Grep,Write,Edit,MultiEdit,Bash';

let session: StoredIdeSession | undefined;
const provider = new E2bSandboxProvider();

async function main() {
  const { apiKey, templateName } = await assertE2bAgentPreflightReady({
    env: process.env,
    templateExists: (candidateTemplateName, candidateApiKey) => Template.exists(candidateTemplateName, {
      apiKey: candidateApiKey,
    }),
  });
  process.env.MYCC_E2B_API_KEY = apiKey;
  process.env.MYCC_IDE_PROVIDER = 'e2b';
  process.env.MYCC_E2B_TEMPLATE = templateName;
  process.env.MYCC_E2B_LINUX_USER = SANDBOX_LINUX_USER;
  process.env.MYCC_E2B_WORKSPACE_DIR = WORKSPACE_DIR;
  process.env.MYCC_IDE_SESSION_TTL_SECONDS = String(SESSION_TTL_SECONDS);
  applyRuntimeSmokeDefaults();

  const store = new InMemoryIdeSessionStore();
  const runtime = createSmokeRuntime(store);

  try {
    await runAgentPrompt(runtime, [
      '你正在 E2B smoke test 的工作区内。',
      `请创建文件 ${AGENT_MARKER_FILE}，内容必须精确等于 ${MARKER}`,
      '请直接完成文件写入，不要只解释。',
    ].join('\n'));
    session = await store.findReusableByUser(SMOKE_USER_ID) ?? undefined;
    if (!session) {
      throw new Error('E2B runtime did not persist a reusable IDE session');
    }

    await assertTemplateContract(session);
    await assertCodeServerLocalHealth(session);
    await assertWorkspaceFileEquals(session, AGENT_MARKER_FILE, MARKER);
    await writeWorkspaceFile(session, IDE_MARKER_FILE, MARKER);
    await runAgentPrompt(runtime, [
      '你正在 E2B smoke test 的工作区内。',
      `请读取当前目录的 ${IDE_MARKER_FILE}，然后创建文件 ${AGENT_READBACK_FILE}，内容必须精确等于 ${MARKER}`,
      '请直接完成文件写入，不要只解释。',
    ].join('\n'));
    await assertWorkspaceFileEquals(session, AGENT_READBACK_FILE, MARKER);
    console.log(`[ok] E2B Agent+IDE workspace smoke passed: runtime=${AGENT_RUNTIME}, sandbox=${session.sandboxId}, marker=${MARKER}`);
  } finally {
    await cleanup();
  }
}

function createSmokeRuntime(store: InMemoryIdeSessionStore): AgentRuntime {
  if (AGENT_RUNTIME === 'e2b-claude-agent-sdk') {
    return new E2bClaudeAgentSdkRuntime({
      sessionStore: store,
      e2bProvider: provider,
    });
  }
  if (AGENT_RUNTIME === 'e2b-claude-cli') {
    return new E2bClaudeCliRuntime({
      sessionStore: store,
      e2bProvider: provider,
    });
  }
  throw new Error(`Unsupported MYCC_SMOKE_E2B_AGENT_RUNTIME: ${AGENT_RUNTIME}`);
}

function applyRuntimeSmokeDefaults(): void {
  if (AGENT_RUNTIME !== 'e2b-claude-agent-sdk') return;
  process.env.MYCC_AGENT_SDK_ALLOWED_TOOLS ||= E2B_AGENT_SDK_SMOKE_ALLOWED_TOOLS;
  process.env.MYCC_AGENT_SDK_PERMISSION_MODE ||= 'bypassPermissions';
}

async function runAgentPrompt(runtime: AgentRuntime, prompt: string): Promise<void> {
  const events = [];

  for await (const event of runtime.chat({
    userId: SMOKE_USER_ID,
    message: prompt,
    cwd: `/home/${PRODUCT_LINUX_USER}/workspace`,
    linuxUser: PRODUCT_LINUX_USER,
  })) {
    events.push(event);
    if (event.type === 'error') {
      throw new Error(`Claude runtime failed: ${String(event.error || 'unknown error')}`);
    }
    if (event.type === 'result' && event.is_error === true) {
      throw new Error(`Claude runtime result error: ${String(event.result || event.error || 'unknown error')}`);
    }
  }
  if (!events.some((event) => event.type === 'result')) {
    throw new Error(`Claude runtime did not emit a result event: ${JSON.stringify(events.slice(-5))}`);
  }
}

async function assertTemplateContract(activeSession: StoredIdeSession): Promise<void> {
  await assertE2bTemplateContract({
    e2bProvider: provider,
    session: activeSession,
    workspaceDir: WORKSPACE_DIR,
    requireCodeServer: true,
    requireClaudeCli: AGENT_RUNTIME === 'e2b-claude-cli',
    requireAgentSdkBridge: AGENT_RUNTIME === 'e2b-claude-agent-sdk',
    requireNativeBuildTools: true,
  });
}

async function assertCodeServerLocalHealth(activeSession: StoredIdeSession): Promise<void> {
  const startedAt = Date.now();
  let lastError = 'not checked';
  while (Date.now() - startedAt < CODE_SERVER_READY_TIMEOUT_MS) {
    try {
      const result = await provider.runCommandInSession(
        activeSession,
        `curl -fsS http://127.0.0.1:${activeSession.port}/healthz`,
        { cwd: WORKSPACE_DIR, timeoutMs: 30_000 },
      );
      if (result.exitCode === 0) return;
      lastError = result.stderr || result.error || result.stdout || `exit=${result.exitCode}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`code-server health check timed out: ${lastError}`);
}

async function writeWorkspaceFile(activeSession: StoredIdeSession, fileName: string, content: string): Promise<void> {
  const result = await provider.runCommandInSession(
    activeSession,
    `printf %s ${escapeShellArg(content)} > ${escapeShellArg(fileName)}`,
    { cwd: WORKSPACE_DIR, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${fileName}: ${result.stderr || result.error || result.stdout}`);
  }
}

async function assertWorkspaceFileEquals(
  activeSession: StoredIdeSession,
  fileName: string,
  expected: string,
): Promise<void> {
  const result = await provider.runCommandInSession(
    activeSession,
    `test "$(cat ${escapeShellArg(fileName)})" = ${escapeShellArg(expected)}`,
    { cwd: WORKSPACE_DIR, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    const actual = await provider.runCommandInSession(
      activeSession,
      `cat ${escapeShellArg(fileName)} 2>/dev/null || true`,
      { cwd: WORKSPACE_DIR, timeoutMs: 30_000 },
    );
    throw new Error(`Expected ${fileName} to contain ${expected}, got ${JSON.stringify(actual.stdout)}`);
  }
}

async function cleanup(): Promise<void> {
  if (!session) return;
  await provider.stopCodeServer(session);
  console.log(`[cleanup] E2B Agent+IDE workspace smoke cleanup complete: sandbox=${session.sandboxId}`);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${raw}`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  if (error instanceof E2bAgentPreflightError) {
    console.error(error.message);
    console.error('[error] E2B Agent+IDE workspace smoke failed: fix the preflight checklist above.');
  } else {
    console.error('[error] E2B Agent+IDE workspace smoke failed:', error);
  }
  process.exitCode = 1;
});
