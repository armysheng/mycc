import dotenv from 'dotenv';
import { Template } from 'e2b';
import {
  buildE2bAgentPreflightReport,
  formatE2bAgentPreflightReport,
} from '../src/ide/e2b-preflight.js';

dotenv.config();

async function main(): Promise<void> {
  const report = await buildE2bAgentPreflightReport({
    env: process.env,
    templateExists: (templateName, apiKey) => Template.exists(templateName, { apiKey }),
  });

  console.log(formatE2bAgentPreflightReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error('[error] E2B Agent preflight failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
