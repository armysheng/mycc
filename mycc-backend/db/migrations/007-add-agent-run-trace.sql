-- Up
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  request_id VARCHAR(160),
  chat_session_id VARCHAR(160),
  sdk_session_id VARCHAR(160),
  runtime_kind VARCHAR(40) NOT NULL CHECK (runtime_kind IN ('remote-claude', 'claude-agent-sdk', 'e2b-claude-cli', 'e2b-claude-agent-sdk')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
  cwd TEXT NOT NULL,
  linux_user VARCHAR(80) NOT NULL,
  permission_mode VARCHAR(40) CHECK (permission_mode IN ('default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto')),
  message_preview TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT 'null'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_events_run_sequence
  ON agent_run_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_started_at
  ON agent_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_request_id
  ON agent_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_session_id
  ON agent_runs(chat_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_type
  ON agent_run_events(type);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_agent_runs_updated_at'
  ) THEN
    CREATE TRIGGER update_agent_runs_updated_at BEFORE UPDATE ON agent_runs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Down (manual rollback only):
-- DROP TRIGGER IF EXISTS update_agent_runs_updated_at ON agent_runs;
-- DROP INDEX IF EXISTS idx_agent_run_events_type;
-- DROP INDEX IF EXISTS idx_agent_runs_chat_session_id;
-- DROP INDEX IF EXISTS idx_agent_runs_request_id;
-- DROP INDEX IF EXISTS idx_agent_runs_user_started_at;
-- DROP INDEX IF EXISTS idx_agent_run_events_run_sequence;
-- DROP TABLE IF EXISTS agent_run_events;
-- DROP TABLE IF EXISTS agent_runs;
