-- Up
ALTER TABLE ide_sessions
  ADD COLUMN IF NOT EXISTS template VARCHAR(120),
  ADD COLUMN IF NOT EXISTS linux_user VARCHAR(80),
  ADD COLUMN IF NOT EXISTS workspace_dir TEXT;

UPDATE ide_sessions
SET template = COALESCE(template, 'mycc-assistant-sandbox-dev'),
    linux_user = COALESCE(linux_user, 'mycc'),
    workspace_dir = COALESCE(workspace_dir, '/home/mycc/workspace');

ALTER TABLE ide_sessions
  ALTER COLUMN template SET NOT NULL,
  ALTER COLUMN linux_user SET NOT NULL,
  ALTER COLUMN workspace_dir SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ide_sessions_reuse_identity
  ON ide_sessions(user_id, status, template, linux_user, workspace_dir, port, expires_at);

-- Down (manual rollback only):
-- DROP INDEX IF EXISTS idx_ide_sessions_reuse_identity;
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS workspace_dir;
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS linux_user;
-- ALTER TABLE ide_sessions DROP COLUMN IF EXISTS template;
