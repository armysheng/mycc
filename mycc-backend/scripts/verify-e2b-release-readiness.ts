import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Check = {
  label: string;
  file: string;
  snippets: string[];
};

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks: Check[] = [
  {
    label: 'package scripts expose E2B release gates',
    file: 'package.json',
    snippets: [
      '"verify:e2b-release"',
      '"doctor:e2b-agent"',
      '"template:e2b-code-server:create"',
      '"smoke:e2b-ide"',
      '"smoke:e2b-agent-sdk-workspace"',
    ],
  },
  {
    label: 'env example documents the E2B product path',
    file: '.env.example',
    snippets: [
      'MYCC_AGENT_RUNTIME=remote-claude',
      'MYCC_WORKSPACE_PROVIDER=ssh',
      'MYCC_IDE_PROVIDER=disabled',
      'MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev',
      'MYCC_E2B_DESKTOP_ENABLED=true',
      'MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false',
      'MYCC_E2B_AGENT_SDK_BRIDGE_COMMAND=',
    ],
  },
  {
    label: 'release checklist covers migration, smoke, and rollback',
    file: 'docs/e2b-release-readiness.md',
    snippets: [
      'db/migrations/003-add-ide-sessions.sql',
      'npm run verify:e2b-release',
      'npm run doctor:e2b-agent',
      'npm run smoke:e2b-ide',
      'npm run smoke:e2b-desktop',
      'npm run smoke:e2b-agent-sdk-workspace',
      'Rollback is config-first',
      'MYCC_AGENT_RUNTIME=remote-claude',
      'MYCC_IDE_PROVIDER=disabled',
    ],
  },
  {
    label: 'operator docs expose the E2B release checklist',
    file: 'README.md',
    snippets: [
      'docs/e2b-release-readiness.md',
      'npm run verify:e2b-release',
      'npm run doctor:e2b-agent',
      'npm run smoke:e2b-desktop',
      'npm run smoke:e2b-agent-sdk-workspace',
    ],
  },
  {
    label: 'deployment guide documents E2B rollback switches',
    file: 'DEPLOYMENT.md',
    snippets: [
      'docs/e2b-release-readiness.md',
      'npm run verify:e2b-release',
      'MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false',
      'MYCC_E2B_DESKTOP_ENABLED=true',
      'MYCC_AGENT_RUNTIME=remote-claude',
      'MYCC_IDE_PROVIDER=disabled',
      'MYCC_WORKSPACE_PROVIDER=ssh',
    ],
  },
  {
    label: 'IDE session migration is idempotent',
    file: 'db/migrations/003-add-ide-sessions.sql',
    snippets: [
      'CREATE TABLE IF NOT EXISTS ide_sessions',
      'CREATE INDEX IF NOT EXISTS idx_ide_sessions_user_id',
      'CREATE INDEX IF NOT EXISTS idx_ide_sessions_status_expires_at',
      'update_ide_sessions_updated_at',
    ],
  },
  {
    label: 'IDE smoke proves raw E2B host stays private',
    file: 'scripts/smoke-e2b-ide.ts',
    snippets: [
      'assertDirectHostRejectsUnauthenticatedTraffic',
      'Direct E2B host accepted unauthenticated traffic',
      'waitForProxyHealth',
      'await pool.end()',
    ],
  },
  {
    label: 'template contract proves real GNU/native runtime behavior',
    file: 'src/ide/e2b-template-contract.ts',
    snippets: [
      'gawk',
      'mycc-c-ok',
      'mycc-cxx-ok',
      'python3 -m venv',
      'mycc-python-ok',
      'npm --prefix',
      'mycc-npm-native-ok',
    ],
  },
  {
    label: 'Agent SDK bridge has a local protocol contract',
    file: 'src/ide/e2b-agent-sdk-bridge-contract.test.ts',
    snippets: [
      'MYCC_AGENT_PROMPT_B64',
      'MYCC_AGENT_SDK_ALLOWED_TOOLS',
      'allowDangerouslySkipPermissions',
      'OPENAI_BASE_URL',
      "not.toHaveProperty('OPENAI_API_KEY')",
    ],
  },
  {
    label: 'template ready command covers runtime dependencies',
    file: '../mycc-sandbox/templates/e2b-assistant-sandbox/contracts/template-contract.sh',
    snippets: [
      'code-server',
      'claude --version',
      'rg jq file lsof',
      'gcc g++ make pkg-config',
      'chromium --version',
      'mycc-start-desktop',
    ],
  },
];

let failureCount = 0;
for (const check of checks) {
  const filePath = path.join(backendRoot, check.file);
  const source = readFileSync(filePath, 'utf8');
  const missing = check.snippets.filter((snippet) => !source.includes(snippet));
  if (missing.length > 0) {
    failureCount += 1;
    console.error(`[error] ${check.label}: ${check.file} is missing ${missing.join(', ')}`);
  } else {
    console.log(`[ok] ${check.label}`);
  }
}

if (failureCount > 0) {
  console.error(`E2B release readiness: ${failureCount} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('E2B release readiness: ready');
}
