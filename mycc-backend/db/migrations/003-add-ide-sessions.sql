-- Up
CREATE TABLE IF NOT EXISTS ide_sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('e2b')),
  sandbox_id VARCHAR(120) NOT NULL,
  code_server_pid INTEGER NOT NULL,
  host VARCHAR(255) NOT NULL,
  traffic_access_token TEXT,
  port INTEGER NOT NULL,
  access_mode VARCHAR(40) NOT NULL CHECK (access_mode IN ('mycc-proxy')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'stopped')),
  proxy_token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ide_sessions_user_id ON ide_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ide_sessions_status_expires_at ON ide_sessions(status, expires_at);

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
    WHERE tgname = 'update_ide_sessions_updated_at'
  ) THEN
    CREATE TRIGGER update_ide_sessions_updated_at BEFORE UPDATE ON ide_sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Down (manual rollback only):
-- DROP TRIGGER IF EXISTS update_ide_sessions_updated_at ON ide_sessions;
-- DROP INDEX IF EXISTS idx_ide_sessions_status_expires_at;
-- DROP INDEX IF EXISTS idx_ide_sessions_user_id;
-- DROP TABLE IF EXISTS ide_sessions;
