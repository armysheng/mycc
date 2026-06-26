import type { QueryResult } from 'pg';
import { randomUUID } from 'node:crypto';
import { pool as defaultPool } from '../db/client.js';
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunStore,
  AppendAgentRunEventInput,
  CreateAgentRunInput,
} from './run-trace.js';

type AgentRunQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

type AgentRunRow = {
  id: string;
  runtime_kind: AgentRun['runtimeKind'];
  status: AgentRun['status'];
  started_at: Date | string;
  ended_at: Date | string | null;
  duration_ms: number | null;
  user_id: number | null;
  request_id: string | null;
  chat_session_id: string | null;
  sdk_session_id: string | null;
  cwd: string;
  linux_user: string;
  permission_mode: AgentRun['permissionMode'] | null;
  message_preview: string;
};

type AgentRunEventRow = {
  id: string;
  run_id: string;
  sequence: number;
  timestamp: Date | string;
  type: string;
  payload: unknown;
};

export class PostgresAgentRunStore implements AgentRunStore {
  constructor(private readonly db: AgentRunQuery = defaultPool) {}

  async createRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const result = await this.db.query<AgentRunRow>(
      `INSERT INTO agent_runs (
         id,
         runtime_kind,
         status,
         started_at,
         ended_at,
         duration_ms,
         user_id,
         request_id,
         chat_session_id,
         sdk_session_id,
         cwd,
         linux_user,
         permission_mode,
         message_preview
       )
       VALUES (
         $1::uuid,
         $2,
         $3,
         $4::timestamptz,
         $5::timestamptz,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14
       )
       RETURNING id,
                 runtime_kind,
                 status,
                 started_at,
                 ended_at,
                 duration_ms,
                 user_id,
                 request_id,
                 chat_session_id,
                 sdk_session_id,
                 cwd,
                 linux_user,
                 permission_mode,
                 message_preview`,
      [
        input.id ?? randomUUID(),
        input.runtimeKind,
        input.status ?? 'running',
        input.startedAt ?? new Date().toISOString(),
        input.endedAt ?? null,
        input.durationMs ?? null,
        input.userId ?? null,
        input.requestId ?? null,
        input.chatSessionId ?? null,
        input.sdkSessionId ?? null,
        input.cwd,
        input.linuxUser,
        input.permissionMode ?? null,
        input.messagePreview ?? '',
      ],
    );

    return fromRunRow(requireRow(result));
  }

  async updateRun(runId: string, patch: Partial<Omit<AgentRun, 'id'>>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    addField(fields, values, 'runtime_kind', patch.runtimeKind);
    addField(fields, values, 'status', patch.status);
    addField(fields, values, 'started_at', patch.startedAt);
    addField(fields, values, 'ended_at', patch.endedAt);
    addField(fields, values, 'duration_ms', patch.durationMs);
    addField(fields, values, 'user_id', patch.userId);
    addField(fields, values, 'request_id', patch.requestId);
    addField(fields, values, 'chat_session_id', patch.chatSessionId);
    addField(fields, values, 'sdk_session_id', patch.sdkSessionId);
    addField(fields, values, 'cwd', patch.cwd);
    addField(fields, values, 'linux_user', patch.linuxUser);
    addField(fields, values, 'permission_mode', patch.permissionMode);
    addField(fields, values, 'message_preview', patch.messagePreview);

    if (fields.length === 0) return;

    values.push(runId);
    await this.db.query(
      `UPDATE agent_runs
       SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length}::uuid`,
      values,
    );
  }

  async appendEvent(input: AppendAgentRunEventInput): Promise<AgentRunEvent> {
    const result = await this.db.query<AgentRunEventRow>(
      `INSERT INTO agent_run_events (
         id,
         run_id,
         sequence,
         timestamp,
         type,
         payload
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         COALESCE($3, (
           SELECT COALESCE(MAX(sequence), 0) + 1
           FROM agent_run_events
           WHERE run_id = $2::uuid
         )),
         $4::timestamptz,
         $5,
         $6::jsonb
       )
       RETURNING id,
                 run_id,
                 sequence,
                 timestamp,
                 type,
                 payload`,
      [
        input.id ?? randomUUID(),
        input.runId,
        input.sequence ?? null,
        input.timestamp ?? new Date().toISOString(),
        input.type,
        JSON.stringify(input.payload ?? null),
      ],
    );

    return fromEventRow(requireRow(result));
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    const result = await this.db.query<AgentRunRow>(
      `SELECT id,
              runtime_kind,
              status,
              started_at,
              ended_at,
              duration_ms,
              user_id,
              request_id,
              chat_session_id,
              sdk_session_id,
              cwd,
              linux_user,
              permission_mode,
              message_preview
       FROM agent_runs
       WHERE id = $1::uuid
       LIMIT 1`,
      [runId],
    );

    return result.rows[0] ? fromRunRow(result.rows[0]) : null;
  }

  async listRunEvents(runId: string): Promise<AgentRunEvent[]> {
    const result = await this.db.query<AgentRunEventRow>(
      `SELECT id,
              run_id,
              sequence,
              timestamp,
              type,
              payload
       FROM agent_run_events
       WHERE run_id = $1::uuid
       ORDER BY sequence ASC`,
      [runId],
    );

    return result.rows.map(fromEventRow);
  }

  async listRuns(filter: {
    userId?: number;
    requestId?: string;
    chatSessionId?: string;
  } = {}): Promise<AgentRun[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filter.userId !== undefined) {
      values.push(filter.userId);
      clauses.push(`user_id = $${values.length}`);
    }
    if (filter.requestId) {
      values.push(filter.requestId);
      clauses.push(`request_id = $${values.length}`);
    }
    if (filter.chatSessionId) {
      values.push(filter.chatSessionId);
      clauses.push(`chat_session_id = $${values.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.db.query<AgentRunRow>(
      `SELECT id,
              runtime_kind,
              status,
              started_at,
              ended_at,
              duration_ms,
              user_id,
              request_id,
              chat_session_id,
              sdk_session_id,
              cwd,
              linux_user,
              permission_mode,
              message_preview
       FROM agent_runs
       ${where}
       ORDER BY started_at DESC
       LIMIT 100`,
      values,
    );

    return result.rows.map(fromRunRow);
  }
}

function addField(
  fields: string[],
  values: unknown[],
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  fields.push(field);
  values.push(value);
}

function requireRow<T extends Record<string, unknown>>(result: QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error('Agent run store query did not return a row');
  }
  return row;
}

function fromRunRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    runtimeKind: row.runtime_kind,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    ...(row.ended_at ? { endedAt: toIsoString(row.ended_at) } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.user_id !== null ? { userId: row.user_id } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.chat_session_id ? { chatSessionId: row.chat_session_id } : {}),
    ...(row.sdk_session_id ? { sdkSessionId: row.sdk_session_id } : {}),
    cwd: row.cwd,
    linuxUser: row.linux_user,
    ...(row.permission_mode ? { permissionMode: row.permission_mode } : {}),
    messagePreview: row.message_preview,
  };
}

function fromEventRow(row: AgentRunEventRow): AgentRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    timestamp: toIsoString(row.timestamp),
    type: row.type,
    payload: row.payload,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
