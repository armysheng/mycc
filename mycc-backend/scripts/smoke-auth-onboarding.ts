import dotenv from 'dotenv';
import { runAuthOnboardingSmoke } from '../src/scripts/auth-onboarding-smoke.js';

dotenv.config();

runAuthOnboardingSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
