import dotenv from 'dotenv';
import { readAuthResult, type AuthResult } from '../src/scripts/local-chat-flow-auth.js';

dotenv.config();

const BASE_URL = (process.env.MYCC_LOCAL_SMOKE_BASE_URL || 'http://127.0.0.1:18081').replace(/\/$/, '');
const PASSWORD = process.env.MYCC_LOCAL_SMOKE_PASSWORD || `MyccSmoke-${Date.now()}!`;
const PROVIDED_CREDENTIAL = process.env.MYCC_LOCAL_SMOKE_CREDENTIAL?.trim();
const GENERATED_EMAIL = `mycc-live-smoke-${Date.now()}@example.test`;
const CREDENTIAL = PROVIDED_CREDENTIAL || GENERATED_EMAIL;
const MARKER = process.env.MYCC_LOCAL_SMOKE_MARKER || `MYCC_LIVE_SMOKE_OK_${Date.now()}`;
const REQUEST_ID = `local-smoke-${Date.now()}`;
const CHAT_TIMEOUT_MS = parsePositiveInteger(process.env.MYCC_LOCAL_SMOKE_TIMEOUT_MS, 180_000);

type JsonObject = Record<string, unknown>;
type StreamSummary = {
  assistantText: string;
  doneSessionId?: string;
  errors: string[];
  eventCount: number;
};

async function main(): Promise<void> {
  console.log(`[smoke] MyCC local chat flow base=${BASE_URL}`);
  const auth = await authenticate();
  console.log(
    `[smoke] authenticated user=${auth.user.id} initialized=${String(auth.user.is_initialized)}`,
  );

  const prompt = `请只回复：${MARKER}`;
  const stream = await sendChatTurn(auth.token, prompt);
  if (stream.errors.length > 0) {
    throw new Error(`chat stream returned errors: ${stream.errors.join(' | ')}`);
  }
  if (!stream.doneSessionId) {
    throw new Error(`chat stream did not emit a session id; events=${stream.eventCount}`);
  }
  if (!stream.assistantText.trim()) {
    throw new Error(`chat stream did not emit assistant text; session=${stream.doneSessionId}`);
  }

  console.log(
    `[smoke] chat stream ok session=${stream.doneSessionId} events=${stream.eventCount} assistantPreview=${preview(stream.assistantText)}`,
  );

  const history = await loadHistory(auth.token, stream.doneSessionId);
  assertHistoryContains(history, prompt, stream.assistantText);
  console.log(
    `[smoke] history reload ok session=${stream.doneSessionId} messages=${history.length}`,
  );
  console.log('[ok] MyCC local chat flow smoke passed');
}

async function authenticate(): Promise<AuthResult> {
  if (PROVIDED_CREDENTIAL) {
    return login(PROVIDED_CREDENTIAL, PASSWORD);
  }

  const response = await postJson('/api/auth/register', {
    email: CREDENTIAL,
    password: PASSWORD,
  });
  if (response.status !== 201 || !response.body?.success) {
    throw new Error(
      `registration failed status=${response.status} error=${safeError(response.body)}`,
    );
  }
  return readAuthResult(response.body);
}

async function login(credential: string, password: string): Promise<AuthResult> {
  const response = await postJson('/api/auth/login', {
    credential,
    password,
  });
  if (response.status !== 200 || !response.body?.success) {
    throw new Error(`login failed status=${response.status} error=${safeError(response.body)}`);
  }
  return readAuthResult(response.body);
}

async function sendChatTurn(token: string, message: string): Promise<StreamSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        requestId: REQUEST_ID,
        workingDirectory: '~/workspace',
        permissionMode: 'bypassPermissions',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`chat request failed status=${response.status} body=${sanitize(text)}`);
    }
    if (!response.body) {
      throw new Error('chat response did not include a stream body');
    }

    const events = await readSseEvents(response.body);
    const errors: string[] = [];
    const assistantParts: string[] = [];
    let doneSessionId: string | undefined;

    for (const event of events) {
      const sessionId = extractSessionId(event);
      if (sessionId) doneSessionId = sessionId;
      const assistantText = extractAssistantText(event);
      if (assistantText) assistantParts.push(assistantText);

      if (event.type === 'error') {
        errors.push(stringField(event, 'error') || 'unknown stream error');
      }
      if (event.type === 'result' && event.is_error === true) {
        errors.push(stringField(event, 'result') || stringField(event, 'error') || 'result error');
      }
      if (event.type === 'aborted') {
        errors.push(stringField(event, 'message') || 'chat stream was paused');
      }
    }

    return {
      assistantText: assistantParts.join('').trim(),
      doneSessionId,
      errors: errors.map(sanitize),
      eventCount: events.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistory(token: string, sessionId: string): Promise<JsonObject[]> {
  const response = await fetch(
    `${BASE_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  const body = await response.json().catch(() => null) as JsonObject | null;
  if (!response.ok || body?.success !== true) {
    throw new Error(`history request failed status=${response.status} error=${safeError(body)}`);
  }
  const data = body.data as JsonObject | undefined;
  const messages = data?.messages;
  if (!Array.isArray(messages)) {
    throw new Error('history response did not include messages');
  }
  return messages.filter((message): message is JsonObject => isObject(message));
}

function assertHistoryContains(history: JsonObject[], prompt: string, assistantText: string): void {
  const visibleText = history.map(extractHistoryText).join('\n');
  if (!visibleText.includes(prompt)) {
    throw new Error(`history did not include the user prompt; text=${preview(visibleText)}`);
  }
  const assistantNeedle = assistantText.slice(0, 80).trim();
  if (assistantNeedle && !visibleText.includes(assistantNeedle)) {
    throw new Error(`history did not include assistant reply; text=${preview(visibleText)}`);
  }
}

async function readSseEvents(stream: ReadableStream<Uint8Array>): Promise<JsonObject[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: JsonObject[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      parseSseChunk(chunk, events);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) {
    parseSseChunk(buffer, events);
  }
  return events;
}

function parseSseChunk(chunk: string, events: JsonObject[]): void {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')
    .trim();
  if (!data) return;
  try {
    const parsed = JSON.parse(data);
    if (isObject(parsed)) events.push(parsed);
  } catch {
    events.push({ type: 'error', error: `unparseable SSE data: ${preview(data)}` });
  }
}

async function postJson(path: string, payload: JsonObject): Promise<{ status: number; body: JsonObject | null }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as JsonObject | null;
  return { status: response.status, body };
}

function extractSessionId(event: JsonObject): string | undefined {
  if (typeof event.sessionId === 'string') return event.sessionId;
  if (typeof event.session_id === 'string') return event.session_id;
  const data = event.data;
  if (isObject(data)) return extractSessionId(data);
  return undefined;
}

function extractAssistantText(event: JsonObject): string {
  const data = event.data;
  if (event.type === 'claude_json' && isObject(data)) {
    return extractAssistantText(data);
  }
  if (event.type !== 'assistant') return '';
  const message = event.message;
  if (!isObject(message) || !Array.isArray(message.content)) return '';
  return message.content
    .map((item) => {
      if (!isObject(item)) return '';
      return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
    })
    .join('');
}

function extractHistoryText(message: JsonObject): string {
  const body = message.message;
  if (isObject(body) && Array.isArray(body.content)) {
    return body.content
      .map((item) => {
        if (!isObject(item)) return '';
        return typeof item.text === 'string' ? item.text : '';
      })
      .join('');
  }
  return typeof message.content === 'string' ? message.content : '';
}

function stringField(source: JsonObject, field: string): string | undefined {
  const value = source[field];
  return typeof value === 'string' ? value : undefined;
}

function safeError(body: JsonObject | null): string {
  if (!body) return 'empty response';
  const error = typeof body.error === 'string' ? body.error : undefined;
  const message = typeof body.message === 'string' ? body.message : undefined;
  return sanitize(error || message || JSON.stringify(body));
}

function sanitize(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, 'Bearer [redacted]')
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"')
    .replace(/(sk-|e2b_live_)[A-Za-z0-9._-]+/g, '$1[redacted]')
    .slice(0, 1000);
}

function preview(text: string): string {
  return sanitize(text.replace(/\s+/g, ' ').trim()).slice(0, 180);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${raw}`);
  }
  return parsed;
}

main().catch((error) => {
  console.error('[error] MyCC local chat flow smoke failed:', error instanceof Error ? error.message : sanitize(String(error)));
  process.exitCode = 1;
});
