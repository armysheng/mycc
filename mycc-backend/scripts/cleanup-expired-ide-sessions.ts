import dotenv from 'dotenv';
import { cleanupExpiredIdeSessions } from '../src/ide/session-cleanup.js';

dotenv.config();

const limit = parsePositiveInteger(process.env.MYCC_IDE_CLEANUP_LIMIT, 50);

async function main() {
  const result = await cleanupExpiredIdeSessions({ limit });
  console.log(JSON.stringify({
    event: 'ide_sessions_cleanup',
    ...result,
  }));

  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${raw}`);
  }
  return parsed;
}

main().catch((error) => {
  console.error('[error] IDE session cleanup failed:', error);
  process.exitCode = 1;
});
