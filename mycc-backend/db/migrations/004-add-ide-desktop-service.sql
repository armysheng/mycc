-- Up
ALTER TABLE ide_sessions
  ADD COLUMN IF NOT EXISTS desktop_pid INTEGER,
  ADD COLUMN IF NOT EXISTS desktop_host VARCHAR(255),
  ADD COLUMN IF NOT EXISTS desktop_port INTEGER;

-- Down (manual rollback only):
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS desktop_port;
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS desktop_host;
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS desktop_pid;
