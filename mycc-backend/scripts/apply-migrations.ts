import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { extractUpMigrationSql } from '../src/scripts/migration-sql.js';

dotenv.config();

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(backendRoot, 'db', 'migrations');
const { Pool } = pg;

function formatMigrationError(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors
      .map((item) => formatMigrationError(item))
      .filter(Boolean)
      .join('; ');
    return details ? `${error.name}: ${details}` : error.name;
  }
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  return String(error);
}

async function main() {
  const migrations = readdirSync(migrationsDir)
    .filter((name) => /^\d+-.+\.sql$/.test(name))
    .sort();

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${migrationsDir}`);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to apply migrations');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations'
    );
    const appliedSet = new Set(applied.rows.map((row) => row.filename));

    for (const filename of migrations) {
      if (appliedSet.has(filename)) {
        console.log(`[skip] ${filename}`);
        continue;
      }

      const sql = extractUpMigrationSql(readFileSync(path.join(migrationsDir, filename), 'utf8'));
      if (!sql) {
        throw new Error(`${filename} has no Up migration SQL`);
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`[ok] ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCli) {
  main().catch((error) => {
    console.error('[error] migration failed:', formatMigrationError(error));
    process.exitCode = 1;
  });
}
