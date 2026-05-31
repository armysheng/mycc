-- Up
CREATE TABLE IF NOT EXISTS skill_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  skill_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
    'download',
    'install',
    'install_failed',
    'update',
    'update_failed',
    'use',
    'uninstall'
  )),
  version VARCHAR(80),
  source VARCHAR(80),
  target_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_events_skill_id_event_type
  ON skill_events(skill_id, event_type);
CREATE INDEX IF NOT EXISTS idx_skill_events_user_id_created_at
  ON skill_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_events_created_at
  ON skill_events(created_at DESC);

-- Down (manual rollback only):
-- DROP INDEX IF EXISTS idx_skill_events_created_at;
-- DROP INDEX IF EXISTS idx_skill_events_user_id_created_at;
-- DROP INDEX IF EXISTS idx_skill_events_skill_id_event_type;
-- DROP TABLE IF EXISTS skill_events;
