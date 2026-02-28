-- Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_initialized BOOLEAN DEFAULT false;

-- Down
ALTER TABLE users DROP COLUMN IF EXISTS is_initialized;
