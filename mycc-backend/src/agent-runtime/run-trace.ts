import { randomUUID } from 'node:crypto';
import type {
  AgentChatParams,
  AgentPermissionMode,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeKind,
} from './types.js';
import {
  setRuntimeSpanStatus,
  startRuntimeSpan,
  type RuntimeSpanHandle,
} from './telemetry.js';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'aborted';

export type AgentRun = {
  id: string;
  runtimeKind: AgentRuntimeKind;
  status: AgentRunStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  userId?: number;
  requestId?: string;
  chatSessionId?: string;
  sdkSessionId?: string;
  cwd: string;
  linuxUser: string;
  permissionMode?: AgentPermissionMode;
  messagePreview: string;
};

export type AgentRunEvent = {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: unknown;
};

export type CreateAgentRunInput = Omit<
  AgentRun,
  'id' | 'status' | 'startedAt' | 'messagePreview'
> & {
  id?: string;
  status?: AgentRunStatus;
  startedAt?: string;
  messagePreview?: string;
};

export type AppendAgentRunEventInput = Omit<
  AgentRunEvent,
  'id' | 'sequence' | 'timestamp'
> & {
  id?: string;
  sequence?: number;
  timestamp?: string;
};

export type AgentRunStore = {
  createRun(input: CreateAgentRunInput): Promise<AgentRun>;
  updateRun(runId: string, patch: Partial<Omit<AgentRun, 'id'>>): Promise<void>;
  appendEvent(input: AppendAgentRunEventInput): Promise<AgentRunEvent>;
  getRun(runId: string): Promise<AgentRun | null>;
  listRunEvents(runId: string): Promise<AgentRunEvent[]>;
  listRuns(filter?: {
    userId?: number;
    requestId?: string;
    chatSessionId?: string;
  }): Promise<AgentRun[]>;
};

export type TracedAgentRuntimeOptions = {
  runStore?: AgentRunStore;
  now?: () => Date;
};

const DEFAULT_MESSAGE_PREVIEW_LENGTH = 180;
const DEFAULT_MAX_STRING_LENGTH = 4_000;
const DEFAULT_MAX_RUNS = 200;
const SECRET_KEY_PATTERN = /(api[-_]?key|auth|authorization|credential|password|proxy[-_]?token|secret|token|traffic[-_]?access)/i;

let defaultAgentRunStore: AgentRunStore | null = null;

export class TracedAgentRuntime implements AgentRuntime {
  public readonly innerRuntime: AgentRuntime;

  private readonly runtimeKind: AgentRuntimeKind;
  private readonly runStore: AgentRunStore;
  private readonly now: () => Date;

  constructor(
    innerRuntime: AgentRuntime,
    runtimeKind: AgentRuntimeKind,
    options: TracedAgentRuntimeOptions = {},
  ) {
    this.innerRuntime = innerRuntime;
    this.runtimeKind = runtimeKind;
    this.runStore = options.runStore ?? getDefaultAgentRunStore();
    this.now = options.now ?? (() => new Date());
  }

  async *chat(params: AgentChatParams): AsyncIterable<AgentRuntimeEvent> {
    const runSpan = startRuntimeSpan('mycc.agent_run', {
      'mycc.agent.runtime_kind': this.runtimeKind,
      'mycc.agent.cwd': params.cwd,
      'mycc.agent.has_images': Boolean(params.images?.length),
      'mycc.agent.image_count': params.images?.length ?? 0,
      'mycc.agent.linux_user': params.linuxUser,
      'mycc.agent.permission_mode': params.permissionMode,
      'mycc.chat_session.id': params.sessionId,
      'mycc.request.id': params.requestId,
      'mycc.user.id': params.userId,
    });
    const recorder = new AgentRunRecorder({
      now: this.now,
      params,
      runStore: this.runStore,
      runtimeKind: this.runtimeKind,
    });
    await recorder.start();

    let terminalStatus: AgentRunStatus = 'succeeded';

    try {
      for await (const event of this.innerRuntime.chat(params)) {
        await recorder.recordRuntimeEvent(event);
        recordRuntimeEventTelemetry(runSpan, event);
        terminalStatus = inferRunStatus(event, terminalStatus);
        yield event;
      }

      if (isAbortRequested(params)) {
        terminalStatus = 'aborted';
      }

      await recorder.finish(terminalStatus);
      runSpan.setAttributes({
        'mycc.agent_run.status': terminalStatus,
      });
      setRuntimeSpanStatus(
        runSpan,
        terminalStatus === 'failed' ? 'error' : (terminalStatus === 'aborted' ? 'unset' : 'ok'),
        terminalStatus,
      );
    } catch (error) {
      const errorEvent: AgentRuntimeEvent = {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      await recorder.recordRuntimeEvent(errorEvent);
      recordRuntimeEventTelemetry(runSpan, errorEvent);
      await recorder.finish('failed');
      runSpan.recordException(error);
      runSpan.setAttributes({
        'mycc.agent_run.status': 'failed',
      });
      setRuntimeSpanStatus(runSpan, 'error', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      runSpan.end();
    }
  }
}

export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly eventsByRun = new Map<string, AgentRunEvent[]>();
  private readonly maxRuns: number;

  constructor(options: { maxRuns?: number } = {}) {
    this.maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS;
  }

  async createRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const run: AgentRun = {
      id: input.id ?? randomUUID(),
      runtimeKind: input.runtimeKind,
      status: input.status ?? 'running',
      startedAt: input.startedAt ?? new Date().toISOString(),
      ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
      ...(input.sdkSessionId ? { sdkSessionId: input.sdkSessionId } : {}),
      cwd: input.cwd,
      linuxUser: input.linuxUser,
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      messagePreview: input.messagePreview ?? '',
    };

    this.runs.set(run.id, run);
    this.eventsByRun.set(run.id, []);
    this.trimOldRuns();
    return { ...run };
  }

  async updateRun(runId: string, patch: Partial<Omit<AgentRun, 'id'>>): Promise<void> {
    const current = this.runs.get(runId);
    if (!current) return;
    this.runs.set(runId, {
      ...current,
      ...patch,
    });
  }

  async appendEvent(input: AppendAgentRunEventInput): Promise<AgentRunEvent> {
    const events = this.eventsByRun.get(input.runId) ?? [];
    const event: AgentRunEvent = {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      sequence: input.sequence ?? events.length + 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      payload: input.payload,
    };

    events.push(event);
    this.eventsByRun.set(input.runId, events);
    return cloneEvent(event);
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  async listRunEvents(runId: string): Promise<AgentRunEvent[]> {
    return (this.eventsByRun.get(runId) ?? []).map(cloneEvent);
  }

  async listRuns(filter: {
    userId?: number;
    requestId?: string;
    chatSessionId?: string;
  } = {}): Promise<AgentRun[]> {
    return Array.from(this.runs.values())
      .filter((run) => filter.userId === undefined || run.userId === filter.userId)
      .filter((run) => !filter.requestId || run.requestId === filter.requestId)
      .filter((run) => !filter.chatSessionId || run.chatSessionId === filter.chatSessionId)
      .map((run) => ({ ...run }));
  }

  clear(): void {
    this.runs.clear();
    this.eventsByRun.clear();
  }

  private trimOldRuns(): void {
    while (this.runs.size > this.maxRuns) {
      const oldestRunId = this.runs.keys().next().value as string | undefined;
      if (!oldestRunId) return;
      this.runs.delete(oldestRunId);
      this.eventsByRun.delete(oldestRunId);
    }
  }
}

export class NoopAgentRunStore implements AgentRunStore {
  async createRun(input: CreateAgentRunInput): Promise<AgentRun> {
    return {
      id: input.id ?? randomUUID(),
      runtimeKind: input.runtimeKind,
      status: input.status ?? 'running',
      startedAt: input.startedAt ?? new Date().toISOString(),
      ...(input.endedAt ? { endedAt: input.endedAt } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
      ...(input.sdkSessionId ? { sdkSessionId: input.sdkSessionId } : {}),
      cwd: input.cwd,
      linuxUser: input.linuxUser,
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      messagePreview: input.messagePreview ?? '',
    };
  }

  async updateRun(): Promise<void> {}

  async appendEvent(input: AppendAgentRunEventInput): Promise<AgentRunEvent> {
    return {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      sequence: input.sequence ?? 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      payload: input.payload,
    };
  }

  async getRun(): Promise<AgentRun | null> {
    return null;
  }

  async listRunEvents(): Promise<AgentRunEvent[]> {
    return [];
  }

  async listRuns(): Promise<AgentRun[]> {
    return [];
  }
}

export function getDefaultAgentRunStore(): AgentRunStore {
  if (!defaultAgentRunStore) {
    defaultAgentRunStore = new InMemoryAgentRunStore();
  }
  return defaultAgentRunStore;
}

export function setDefaultAgentRunStore(store: AgentRunStore | null): void {
  defaultAgentRunStore = store;
}

export function redactTracePayload(value: unknown): unknown {
  return redactTraceValue(value, 0);
}

class AgentRunRecorder {
  private readonly now: () => Date;
  private readonly params: AgentChatParams;
  private readonly runStore: AgentRunStore;
  private readonly runtimeKind: AgentRuntimeKind;
  private runId: string | null = null;
  private startedAt = 0;
  private sdkSessionId: string | undefined;

  constructor(options: {
    now: () => Date;
    params: AgentChatParams;
    runStore: AgentRunStore;
    runtimeKind: AgentRuntimeKind;
  }) {
    this.now = options.now;
    this.params = options.params;
    this.runStore = options.runStore;
    this.runtimeKind = options.runtimeKind;
  }

  async start(): Promise<void> {
    this.startedAt = this.now().getTime();
    await this.guard(async () => {
      const run = await this.runStore.createRun({
        runtimeKind: this.runtimeKind,
        userId: this.params.userId,
        requestId: this.params.requestId,
        chatSessionId: this.params.sessionId,
        cwd: this.params.cwd,
        linuxUser: this.params.linuxUser,
        permissionMode: this.params.permissionMode,
        messagePreview: previewMessage(this.params.message),
        startedAt: new Date(this.startedAt).toISOString(),
      });
      this.runId = run.id;
      await this.appendEvent('run.started', {
        cwd: this.params.cwd,
        hasImages: Boolean(this.params.images?.length),
        linuxUser: this.params.linuxUser,
        permissionMode: this.params.permissionMode,
        requestId: this.params.requestId,
        runtimeKind: this.runtimeKind,
        userId: this.params.userId,
      });
    });
  }

  async recordRuntimeEvent(event: AgentRuntimeEvent): Promise<void> {
    const sessionId = readSdkSessionId(event);
    if (sessionId && sessionId !== this.sdkSessionId) {
      this.sdkSessionId = sessionId;
      await this.updateRun({ sdkSessionId: sessionId });
    }

    await this.appendEvent('runtime.event', event);
  }

  async finish(status: AgentRunStatus): Promise<void> {
    const endedAt = this.now();
    const patch = {
      status,
      endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - this.startedAt),
      ...(this.sdkSessionId ? { sdkSessionId: this.sdkSessionId } : {}),
    };
    await this.updateRun(patch);
    await this.appendEvent('run.finished', patch);
  }

  private async updateRun(patch: Partial<Omit<AgentRun, 'id'>>): Promise<void> {
    if (!this.runId) return;
    await this.guard(async () => {
      await this.runStore.updateRun(this.runId as string, patch);
    });
  }

  private async appendEvent(type: string, payload: unknown): Promise<void> {
    if (!this.runId) return;
    await this.guard(async () => {
      await this.runStore.appendEvent({
        runId: this.runId as string,
        timestamp: this.now().toISOString(),
        type,
        payload: redactTracePayload(payload),
      });
    });
  }

  private async guard(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      console.warn(
        'Agent run trace operation failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function inferRunStatus(event: AgentRuntimeEvent, current: AgentRunStatus): AgentRunStatus {
  if (event.type === 'error') return 'failed';
  if (event.type !== 'result') return current;
  if (event.is_error === true) return 'failed';
  if (event.is_error === false) return 'succeeded';
  return current;
}

function readSdkSessionId(event: AgentRuntimeEvent): string | undefined {
  const sessionId = event.session_id;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined;
}

function recordRuntimeEventTelemetry(span: RuntimeSpanHandle, event: AgentRuntimeEvent): void {
  const eventAttributes = {
    'mycc.agent.event_type': event.type,
    'mycc.agent.event_subtype': typeof event.subtype === 'string' ? event.subtype : undefined,
    'mycc.agent.sdk_session_id': readSdkSessionId(event),
    'mycc.agent.is_error': typeof event.is_error === 'boolean' ? event.is_error : undefined,
  };
  span.addEvent('mycc.agent.runtime_event', eventAttributes);
  if (event.type === 'result') {
    span.setAttributes({
      'mycc.agent.result_subtype': typeof event.subtype === 'string' ? event.subtype : undefined,
      'mycc.agent.result_is_error': typeof event.is_error === 'boolean' ? event.is_error : undefined,
    });
  }

  for (const tool of extractToolTelemetryEvents(event)) {
    span.addEvent('mycc.agent.tool_event', {
      'mycc.agent.tool_id': tool.id,
      'mycc.agent.tool_name': tool.name,
      'mycc.agent.tool_status': tool.status,
    });
    const toolSpan = startRuntimeSpan('mycc.agent_tool', {
      'mycc.agent.event_type': event.type,
      'mycc.agent.tool_id': tool.id,
      'mycc.agent.tool_name': tool.name,
      'mycc.agent.tool_status': tool.status,
    });
    setRuntimeSpanStatus(toolSpan, tool.status === 'failed' ? 'error' : 'ok', tool.status);
    toolSpan.end();
  }
}

function extractToolTelemetryEvents(event: AgentRuntimeEvent): Array<{
  id?: string;
  name: string;
  status: 'started' | 'completed' | 'failed';
}> {
  const tools: Array<{ id?: string; name: string; status: 'started' | 'completed' | 'failed' }> = [];
  const topLevelToolName = readStringProperty(event, 'tool_name') ?? readStringProperty(event, 'toolName');
  if (topLevelToolName) {
    tools.push({
      id: readStringProperty(event, 'tool_use_id') ?? readStringProperty(event, 'toolUseId'),
      name: topLevelToolName,
      status: event.type === 'error' || event.is_error === true ? 'failed' : 'started',
    });
  }

  const message = readObjectProperty(event, 'message');
  const content = message ? readArrayProperty(message, 'content') : readArrayProperty(event, 'content');
  for (const block of content ?? []) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    const blockType = typeof record.type === 'string' ? record.type : '';
    if (blockType === 'tool_use') {
      const name = typeof record.name === 'string' && record.name.trim() ? record.name : 'tool';
      tools.push({
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        status: 'started',
      });
      continue;
    }
    if (blockType === 'tool_result') {
      tools.push({
        id: typeof record.tool_use_id === 'string' ? record.tool_use_id : undefined,
        name: 'tool_result',
        status: record.is_error === true ? 'failed' : 'completed',
      });
    }
  }

  return tools;
}

function readStringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function readObjectProperty(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const raw = value[key];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
}

function readArrayProperty(value: Record<string, unknown>, key: string): unknown[] | undefined {
  const raw = value[key];
  return Array.isArray(raw) ? raw : undefined;
}

function isAbortRequested(params: AgentChatParams): boolean {
  return Boolean(params.signal?.aborted || params.abortController?.signal.aborted);
}

function previewMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= DEFAULT_MESSAGE_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, DEFAULT_MESSAGE_PREVIEW_LENGTH)}...`;
}

function redactTraceValue(value: unknown, depth: number): unknown {
  if (depth > 12) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactTraceValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : redactTraceValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function truncateString(value: string): string {
  if (value.length <= DEFAULT_MAX_STRING_LENGTH) return value;
  return `${value.slice(0, DEFAULT_MAX_STRING_LENGTH)}...[truncated ${value.length - DEFAULT_MAX_STRING_LENGTH} chars]`;
}

function cloneEvent(event: AgentRunEvent): AgentRunEvent {
  return {
    ...event,
    payload: structuredCloneSafe(event.payload),
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
