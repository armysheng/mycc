import dotenv from 'dotenv';
import { Template } from 'e2b';
import { randomUUID } from 'node:crypto';
import { E2bClaudeCliRuntime } from '../src/agent-runtime/e2b-claude-cli-runtime.js';
import { E2bSandboxProvider } from '../src/ide/e2b-provider.js';
import { buildE2bCodeServerSessionPlan } from '../src/ide/service.js';
import { InMemoryIdeSessionStore, type StoredIdeSession } from '../src/ide/session-store.js';
import { escapeShellArg } from '../src/utils/validation.js';

dotenv.config();

const TEMPLATE_NAME = process.env.MYCC_E2B_TEMPLATE || 'mycc-code-server-dev';
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

let session: StoredIdeSession | undefined;
const provider = new E2bSandboxProvider();

async function main() {
  const apiKey = process.env.MYCC_E2B_API_KEY || process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error('MYCC_E2B_API_KEY or E2B_API_KEY is required');
  }
  process.env.MYCC_E2B_API_KEY = apiKey;
  process.env.MYCC_IDE_PROVIDER = 'e2b';
  process.env.MYCC_E2B_TEMPLATE = TEMPLATE_NAME;
  process.env.MYCC_E2B_LINUX_USER = SANDBOX_LINUX_USER;
  process.env.MYCC_E2B_WORKSPACE_DIR = WORKSPACE_DIR;
  process.env.MYCC_IDE_SESSION_TTL_SECONDS = String(SESSION_TTL_SECONDS);

  requireClaudeCredential();

  const templateExists = await Template.exists(TEMPLATE_NAME, { apiKey });
  if (!templateExists) {
    throw new Error(`E2B template does not exist: ${TEMPLATE_NAME}`);
  }

  const plan = buildE2bCodeServerSessionPlan({
    userId: SMOKE_USER_ID,
    linuxUser: PRODUCT_LINUX_USER,
    workspaceDir: `/home/${PRODUCT_LINUX_USER}/workspace`,
  });
  const started = await provider.startCodeServer(plan);
  session = {
    ...started,
    id: randomUUID(),
    proxyToken: randomUUID(),
    userId: SMOKE_USER_ID,
    status: 'running',
  };

  try {
    await assertCodeServerLocalHealth(session);
    await writeWorkspaceFile(session, IDE_MARKER_FILE, MARKER);
    await runAgentRoundTrip(session);
    await assertWorkspaceFileEquals(session, AGENT_READBACK_FILE, MARKER);
    await assertWorkspaceFileEquals(session, AGENT_MARKER_FILE, MARKER);
    console.log(`[ok] E2B Agent+IDE workspace smoke passed: sandbox=${session.sandboxId}, marker=${MARKER}`);
  } finally {
    await cleanup();
  }
}

async function runAgentRoundTrip(activeSession: StoredIdeSession): Promise<void> {
  const store = new InMemoryIdeSessionStore();
  await store.set(activeSession);
  const runtime = new E2bClaudeCliRuntime({
    sessionStore: store,
    e2bProvider: provider,
  });
  const events = [];
  const prompt = [
    '你正在 E2B smoke test 的工作区内。',
    `请读取当前目录的 ${IDE_MARKER_FILE}，然后创建两个文件：`,
    `1. ${AGENT_READBACK_FILE}，内容必须精确等于 ${MARKER}`,
    `2. ${AGENT_MARKER_FILE}，内容必须精确等于 ${MARKER}`,
    '请直接完成文件写入，不要只解释。',
  ].join('\n');

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

async function assertCodeServerLocalHealth(activeSession: StoredIdeSession): Promise<void> {
  const startedAt = Date.now();
  let lastError = 'not checked';
  while (Date.now() - startedAt < CODE_SERVER_READY_TIMEOUT_MS) {
    const result = await provider.runCommandInSession(
      activeSession,
      `curl -fsS http://127.0.0.1:${activeSession.port}/healthz`,
      { cwd: WORKSPACE_DIR, timeoutMs: 30_000 },
    );
    if (result.exitCode === 0) return;
    lastError = result.stderr || result.error || result.stdout || `exit=${result.exitCode}`;
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

function requireClaudeCredential(): void {
  if (
    process.env.MYCC_AGENT_SDK_AUTH_TOKEN
    || process.env.ANTHROPIC_AUTH_TOKEN
    || process.env.VPS_ANTHROPIC_AUTH_TOKEN
    || process.env.MYCC_AGENT_SDK_API_KEY
    || process.env.ANTHROPIC_API_KEY
  ) {
    return;
  }
  throw new Error('A Claude credential is required: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN');
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
  console.error('[error] E2B Agent+IDE workspace smoke failed:', error);
  process.exitCode = 1;
});
