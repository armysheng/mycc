import dotenv from 'dotenv';
import { runPublicSurfaceSmoke } from '../src/scripts/public-surface-smoke.js';

dotenv.config();

runPublicSurfaceSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
