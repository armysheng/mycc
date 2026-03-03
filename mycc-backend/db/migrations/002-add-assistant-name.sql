-- Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_name VARCHAR(50);

-- Down
ALTER TABLE users DROP COLUMN IF EXISTS assistant_name;
