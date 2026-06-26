import { describe, expect, it } from 'vitest';
import { extractUpMigrationSql } from './migration-sql.js';

describe('apply migrations script', () => {
  it('executes only the Up section before rollback SQL', () => {
    const sql = extractUpMigrationSql(`
-- Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_initialized BOOLEAN DEFAULT false;

-- Down
ALTER TABLE users DROP COLUMN IF EXISTS is_initialized;
`);

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_initialized');
    expect(sql).not.toContain('DROP COLUMN');
  });
});
