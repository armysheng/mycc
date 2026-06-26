import type { QueryResult } from 'pg';
import { pool as defaultPool } from '../db/client.js';
import type { StartedCodeServerSession, StartedDesktopService } from './e2b-provider.js';

export type IdeSessionStatus = 'running' | 'stopped';

export type StoredIdeSession = StartedCodeServerSession & Partial<StartedDesktopService> & {
  id: string;
  template: string;
  linuxUser: string;
  workspaceDir: string;
  proxyToken: string;
  userId: number;
  status: IdeSessionStatus;
  desktopPid?: number;
  desktopHost?: string;
  desktopPort?: number;
};

export type IdeSessionReuseCriteria = {
  template: string;
  linuxUser: string;
  workspaceDir: string;
  port: number;
};

export type IdeSessionStore = {
  get(sessionId: string): Promise<StoredIdeSession | null>;
  set(session: StoredIdeSession): Promise<void>;
  findReusableByUser(userId: number, criteria?: IdeSessionReuseCriteria): Promise<StoredIdeSession | null>;
  findExpiredRunning(now: Date, limit: number): Promise<StoredIdeSession[]>;
};

type IdeSessionQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

type IdeSessionRow = {
  id: string;
  user_id: number;
  provider: 'e2b';
  template: string;
  linux_user: string;
  workspace_dir: string;
  sandbox_id: string;
  code_server_pid: number;
  host: string;
  traffic_access_token: string | null;
  port: number;
  desktop_pid: number | null;
  desktop_host: string | null;
  desktop_port: number | null;
  access_mode: 'mycc-proxy';
  status: IdeSessionStatus;
  proxy_token: string;
  expires_at: Date | string;
};

export class InMemoryIdeSessionStore implements IdeSessionStore {
  constructor(private readonly sessions = new Map<string, StoredIdeSession>()) {}

  async get(sessionId: string): Promise<StoredIdeSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async set(session: StoredIdeSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async findReusableByUser(userId: number, criteria?: IdeSessionReuseCriteria): Promise<StoredIdeSession | null> {
    const now = Date.now();
    const candidates = Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .filter((session) => session.status === 'running')
      .filter((session) => new Date(session.expiresAt).getTime() > now)
      .filter((session) => !criteria || matchesReuseCriteria(session, criteria));
    return candidates.at(-1) ?? null;
  }

  async findExpiredRunning(now: Date, limit: number): Promise<StoredIdeSession[]> {
    const cutoff = now.getTime();
    return Array.from(this.sessions.values())
      .filter((session) => session.status === 'running')
      .filter((session) => new Date(session.expiresAt).getTime() <= cutoff)
      .slice(0, Math.max(0, limit));
  }
}

export class PostgresIdeSessionStore implements IdeSessionStore {
  constructor(private readonly db: IdeSessionQuery = defaultPool) {}

  async get(sessionId: string): Promise<StoredIdeSession | null> {
    const result = await this.db.query<IdeSessionRow>(
      `SELECT id,
              user_id,
              provider,
              template,
              linux_user,
              workspace_dir,
              sandbox_id,
              code_server_pid,
              host,
              traffic_access_token,
              port,
              desktop_pid,
              desktop_host,
              desktop_port,
              access_mode,
              status,
              proxy_token,
              expires_at
       FROM ide_sessions
       WHERE id = $1
       LIMIT 1`,
      [sessionId],
    );

    const row = result.rows[0];
    return row ? fromRow(row) : null;
  }

  async set(session: StoredIdeSession): Promise<void> {
    await this.db.query(
      `INSERT INTO ide_sessions (
         id,
         user_id,
         provider,
         template,
         linux_user,
         workspace_dir,
         sandbox_id,
         code_server_pid,
         host,
         traffic_access_token,
         port,
         desktop_pid,
         desktop_host,
         desktop_port,
         access_mode,
         status,
         proxy_token,
         expires_at,
         stopped_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::timestamptz)
       ON CONFLICT (id)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     provider = EXCLUDED.provider,
                     template = EXCLUDED.template,
                     linux_user = EXCLUDED.linux_user,
                     workspace_dir = EXCLUDED.workspace_dir,
                     sandbox_id = EXCLUDED.sandbox_id,
                     code_server_pid = EXCLUDED.code_server_pid,
                     host = EXCLUDED.host,
                     traffic_access_token = EXCLUDED.traffic_access_token,
                     port = EXCLUDED.port,
                     desktop_pid = EXCLUDED.desktop_pid,
                     desktop_host = EXCLUDED.desktop_host,
                     desktop_port = EXCLUDED.desktop_port,
                     access_mode = EXCLUDED.access_mode,
                     status = EXCLUDED.status,
                     proxy_token = EXCLUDED.proxy_token,
                     expires_at = EXCLUDED.expires_at,
                     stopped_at = EXCLUDED.stopped_at,
                     updated_at = NOW()`,
      [
        session.id,
        session.userId,
        session.provider,
        session.template,
        session.linuxUser,
        session.workspaceDir,
        session.sandboxId,
        session.codeServerPid,
        session.host,
        session.trafficAccessToken ?? null,
        session.port,
        session.desktopPid ?? null,
        session.desktopHost ?? null,
        session.desktopPort ?? null,
        session.accessMode,
        session.status,
        session.proxyToken,
        session.expiresAt,
        session.status === 'stopped' ? new Date().toISOString() : null,
      ],
    );
  }

  async findReusableByUser(userId: number, criteria?: IdeSessionReuseCriteria): Promise<StoredIdeSession | null> {
    const clauses = [
      'user_id = $1',
      'status = $2',
      'expires_at > NOW()',
    ];
    const values: unknown[] = [userId, 'running'];
    if (criteria) {
      values.push(criteria.template);
      clauses.push(`template = $${values.length}`);
      values.push(criteria.linuxUser);
      clauses.push(`linux_user = $${values.length}`);
      values.push(criteria.workspaceDir);
      clauses.push(`workspace_dir = $${values.length}`);
      values.push(criteria.port);
      clauses.push(`port = $${values.length}`);
    }

    const result = await this.db.query<IdeSessionRow>(
      `SELECT id,
              user_id,
              provider,
              template,
              linux_user,
              workspace_dir,
              sandbox_id,
              code_server_pid,
              host,
              traffic_access_token,
              port,
              desktop_pid,
              desktop_host,
              desktop_port,
              access_mode,
              status,
              proxy_token,
              expires_at
       FROM ide_sessions
       WHERE ${clauses.join('\n         AND ')}
       ORDER BY updated_at DESC
       LIMIT 1`,
      values,
    );

    const row = result.rows[0];
    return row ? fromRow(row) : null;
  }

  async findExpiredRunning(now: Date, limit: number): Promise<StoredIdeSession[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
    const result = await this.db.query<IdeSessionRow>(
      `SELECT id,
              user_id,
              provider,
              template,
              linux_user,
              workspace_dir,
              sandbox_id,
              code_server_pid,
              host,
              traffic_access_token,
              port,
              desktop_pid,
              desktop_host,
              desktop_port,
              access_mode,
              status,
              proxy_token,
              expires_at
       FROM ide_sessions
       WHERE status = $1
         AND expires_at <= $2::timestamptz
       ORDER BY expires_at ASC
       LIMIT $3`,
      ['running', now.toISOString(), safeLimit],
    );

    return result.rows.map(fromRow);
  }
}

function fromRow(row: IdeSessionRow): StoredIdeSession {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    template: row.template,
    linuxUser: row.linux_user,
    workspaceDir: row.workspace_dir,
    sandboxId: row.sandbox_id,
    codeServerPid: row.code_server_pid,
    host: row.host,
    ...(row.traffic_access_token ? { trafficAccessToken: row.traffic_access_token } : {}),
    port: row.port,
    ...(row.desktop_pid ? { desktopPid: row.desktop_pid } : {}),
    ...(row.desktop_host ? { desktopHost: row.desktop_host } : {}),
    ...(row.desktop_port ? { desktopPort: row.desktop_port } : {}),
    accessMode: row.access_mode,
    status: row.status,
    proxyToken: row.proxy_token,
    expiresAt: toIsoString(row.expires_at),
  };
}

function matchesReuseCriteria(session: StoredIdeSession, criteria: IdeSessionReuseCriteria): boolean {
  return session.template === criteria.template
    && session.linuxUser === criteria.linuxUser
    && session.workspaceDir === criteria.workspaceDir
    && session.port === criteria.port;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
