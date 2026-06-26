import dotenv from 'dotenv';
import { runAuthPrivacySmoke } from '../src/scripts/auth-onboarding-smoke.js';

dotenv.config();

runAuthPrivacySmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
