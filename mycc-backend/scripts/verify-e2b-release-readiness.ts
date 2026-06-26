import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SnippetRequirement = string | {
  label: string;
  anyOf: string[];
};

type Check = {
  label: string;
  file: string;
  snippets: SnippetRequirement[];
  forbiddenSnippets?: string[];
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
      '"harness:verify"',
      '"landing:classify"',
      '"smoke:e2b-ide"',
      '"smoke:e2b-agent-sdk-workspace"',
    ],
  },
  {
    label: 'package scripts expose migration gates',
    file: 'package.json',
    snippets: [
      '"db:migrate"',
      'scripts/apply-migrations.ts',
    ],
  },
  {
    label: 'env example documents the E2B product path',
    file: '.env.example',
    snippets: [
      'MYCC_AGENT_RUNTIME=e2b-claude-agent-sdk',
      'MYCC_WORKSPACE_PROVIDER=e2b',
      'MYCC_IDE_PROVIDER=e2b',
      'MYCC_E2B_TEMPLATE=mycc-assistant-sandbox-dev',
      'MYCC_E2B_DESKTOP_ENABLED=true',
      'MYCC_E2B_ALLOW_PUBLIC_TRAFFIC=false',
      'MYCC_E2B_AGENT_SDK_BRIDGE_COMMAND=',
      'MYCC_AGENT_SDK_MODEL=claude-opus-4-7',
      'MYCC_AGENT_SDK_ALLOWED_TOOLS=Read,Glob,Grep,Bash,Edit,Write',
      'MYCC_AGENT_RUN_STORE=postgres',
      '/home/{linuxUser}/.claude',
    ],
    forbiddenSnippets: [
      '/home/{linuxUser}/.mycc/{home,claude}',
      '/home/{linux_user}/.mycc',
    ],
  },
  {
    label: 'release checklist covers migration, smoke, and rollback',
	    file: 'docs/e2b-release-readiness.md',
	    snippets: [
	      'db/migrations/003-add-ide-sessions.sql',
	      'db/migrations/008-add-ide-session-identity.sql',
	      'db/migrations/007-add-agent-run-trace.sql',
      'npm run db:migrate',
      'npm run verify:e2b-release',
      'npm run harness:verify -- --target=landing --no-write',
      'npm run harness:verify -- --target=landing-live --no-write',
      'npm run landing:classify -- --fail-on-unclassified',
      'npm run doctor:e2b-agent',
      'npm run smoke:e2b-ide',
      'npm run smoke:e2b-desktop',
      'npm run smoke:e2b-agent-sdk-workspace',
      'Rollback is config-first',
      'MYCC_AGENT_RUNTIME=remote-claude',
      'MYCC_IDE_PROVIDER=disabled',
      'MYCC_AGENT_RUN_STORE=postgres',
    ],
  },
  {
    label: 'local codex dev script applies migrations before backend startup',
	    file: '../scripts/dev-codex.sh',
	    snippets: [
	      'npm run db:migrate',
	      'MYCC_AGENT_RUN_STORE="${MYCC_AGENT_RUN_STORE:-postgres}"',
	      'MYCC_AGENT_RUNTIME="${MYCC_AGENT_RUNTIME:-e2b-claude-agent-sdk}"',
	      'MYCC_IDE_PROVIDER="${MYCC_IDE_PROVIDER:-e2b}"',
	      'MYCC_WORKSPACE_PROVIDER="${MYCC_WORKSPACE_PROVIDER:-e2b}"',
	      'PORT=8081 npm run dev',
    ],
  },
  {
    label: 'docs keep runtime skills out of workspace and legacy mycc skill dirs',
    file: '../docs/mycc-skill-center-integration.md',
    snippets: [
      '/home/<linuxUser>/.claude/skills/<assistantSkillName>',
      'Treat `id` as the MyCC market/API/statistics key',
      'Treat `assistantSkillName` as the Claude-visible skill name',
      '/home/mycc/.claude/skills',
    ],
    forbiddenSnippets: [
      '/home/<linuxUser>/.claude/skills/<skillId>',
      'workspace/.claude/skills',
      '.mycc/skills',
      '.mycc/claude/skills',
    ],
  },
  {
    label: 'operator docs expose the E2B release checklist',
    file: 'README.md',
    snippets: [
      'docs/e2b-release-readiness.md',
      'npm run harness:verify -- --target=landing --no-write',
      'npm run harness:verify -- --target=landing-live --no-write',
      'npm run verify:e2b-release',
      'npm run doctor:e2b-agent',
      'npm run smoke:e2b-desktop',
      'npm run smoke:e2b-agent-sdk-workspace',
    ],
  },
  {
    label: 'backend index registers readiness routes',
    file: 'src/index.ts',
    snippets: [
      "import { registerReadinessRoutes } from './routes/readiness.js';",
      'await fastify.register(registerReadinessRoutes);',
    ],
  },
  {
    label: 'deep readiness route exposes protected readiness probes',
    file: 'src/routes/readiness.ts',
    snippets: [
      "fastify.get('/readyz/deep'",
      'buildReadinessResponse({',
      'checkRuntime,',
    ],
  },
  {
    label: 'deep readiness route requires operator authorization',
    file: 'src/routes/readiness.ts',
    snippets: [
      "fastify.get('/readyz/deep'",
      'request.headers',
      {
        label: 'authorizeDeepReadinessRequest or token protection',
        anyOf: [
          'authorizeDeepReadinessRequest({',
          'MYCC_READYZ_DEEP_TOKEN',
          'READYZ_DEEP_TOKEN_HEADER',
        ],
      },
      {
        label: 'unauthorized response',
        anyOf: [
          'reply.status(auth.statusCode).send(auth.body)',
          'reply.status(401)',
          'readyz_deep_unauthorized',
        ],
      },
    ],
  },
  {
    label: 'deep readiness probes E2B Agent runtime preflight',
    file: 'src/routes/readiness.ts',
    snippets: [
      'checkRuntimeReadiness',
      'buildE2bAgentPreflightReport',
      'Template.exists',
    ],
  },
  {
    label: 'landing harness gates cover builds, release checks, and live smoke',
    file: 'scripts/harness-verify.ts',
    snippets: [
      "id: 'backend-build'",
      "id: 'frontend-build'",
      "id: 'backend-tests'",
      "id: 'frontend-product-tests'",
      "id: 'e2b-ide-smoke'",
      "id: 'e2b-desktop-smoke'",
      "id: 'e2b-agent-sdk-smoke'",
      "id: 'landing'",
      "id: 'landing-live'",
      "'backend-tests'",
      "'frontend-product-tests'",
    ],
  },
  {
    label: 'landing PR classifier is wired into package scripts',
    file: 'scripts/landing-pr-classify.ts',
    snippets: [
      'pr1-landing-gate',
      'pr2-skills-product',
      'pr3-backend-runtime',
      'pr4-sandbox-desktop',
      'pr5-frontend-workbench',
      'needs-owner-review',
      'do-not-stage',
      'unclassified',
      '--fail-on-unclassified',
    ],
  },
  {
    label: 'landing checklist documents ship/no-ship criteria',
    file: 'docs/landing-readiness.md',
    snippets: [
      'Status: public staging preview live; guided friendly-test candidate, not unrestricted public launch.',
      'https://daoyou.iaigc.fun',
      'GET https://daoyou.iaigc.fun/readyz/deep',
      'Backend tests pass.',
      'Product-facing frontend tests pass.',
      'npm run harness:verify -- --target=landing --no-write',
      'npm run harness:verify -- --target=landing-live --no-write',
      'Release boundary cleanup',
      'Staging deployment rehearsal',
      'Product copy and surface audit',
      'Operations rollback rehearsal',
    ],
  },
  {
    label: 'staging deploy verifies deep runtime readiness',
    file: '../.github/workflows/deploy-staging.yml',
    snippets: [
      'READY_URL="${STAGING_BACKEND_READY_URL:-http://127.0.0.1:8080/readyz/deep}"',
      'Backend deep readiness check passed',
      '"runtime"[[:space:]]*:[[:space:]]*\\{[^}]*"status"[[:space:]]*:[[:space:]]*"pass"',
      'curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/readyz/deep',
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
      'MYCC_AGENT_RUN_STORE=postgres',
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
	    label: 'agent run trace migration is idempotent',
    file: 'db/migrations/007-add-agent-run-trace.sql',
    snippets: [
      'CREATE TABLE IF NOT EXISTS agent_runs',
      'CREATE TABLE IF NOT EXISTS agent_run_events',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_user_started_at',
      'update_agent_runs_updated_at',
    ],
	  },
  {
    label: 'IDE session identity migration is idempotent',
    file: 'db/migrations/008-add-ide-session-identity.sql',
    snippets: [
      'ADD COLUMN IF NOT EXISTS template',
      'ADD COLUMN IF NOT EXISTS linux_user',
      'ADD COLUMN IF NOT EXISTS workspace_dir',
      'idx_ide_sessions_reuse_identity',
    ],
  },
  {
    label: 'IDE sessions are reused by sandbox workspace identity',
    file: 'src/ide/session-store.ts',
    snippets: [
      'IdeSessionReuseCriteria',
      'template = $',
      'linux_user = $',
      'workspace_dir = $',
      'matchesReuseCriteria',
    ],
  },
  {
    label: 'E2B code-server sessions wait for readiness before exposure',
    file: 'src/ide/e2b-provider.ts',
    snippets: [
      'waitForCodeServerHealthy',
      'code-server did not become ready',
      'MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS',
      '127.0.0.1:${port}/healthz',
    ],
  },
  {
    label: 'E2B code-server template initializes Claude home instead of legacy mycc home',
    file: 'templates/e2b-code-server/e2b.Dockerfile',
    snippets: [
      '/home/mycc/.claude',
      '/home/mycc/workspace',
    ],
    forbiddenSnippets: [
      '/home/mycc/.mycc',
    ],
  },
  {
    label: 'agent run trace migration is idempotent',
    file: 'db/migrations/007-add-agent-run-trace.sql',
    snippets: [
      'CREATE TABLE IF NOT EXISTS agent_runs',
      'CREATE TABLE IF NOT EXISTS agent_run_events',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_user_started_at',
      'update_agent_runs_updated_at',
    ],
  },
  {
    label: 'IDE session identity migration is idempotent',
    file: 'db/migrations/008-add-ide-session-identity.sql',
    snippets: [
      'ADD COLUMN IF NOT EXISTS template',
      'ADD COLUMN IF NOT EXISTS linux_user',
      'ADD COLUMN IF NOT EXISTS workspace_dir',
      'idx_ide_sessions_reuse_identity',
    ],
  },
  {
    label: 'IDE sessions are reused by sandbox workspace identity',
    file: 'src/ide/session-store.ts',
    snippets: [
      'IdeSessionReuseCriteria',
      'template = $',
      'linux_user = $',
      'workspace_dir = $',
      'matchesReuseCriteria',
    ],
  },
  {
    label: 'E2B code-server sessions wait for readiness before exposure',
    file: 'src/ide/e2b-provider.ts',
    snippets: [
      'waitForCodeServerHealthy',
      'code-server did not become ready',
      'MYCC_E2B_CODE_SERVER_READY_TIMEOUT_MS',
      '127.0.0.1:${port}/healthz',
    ],
  },
  {
    label: 'Agent SDK product defaults use broad tools with hook guard and Opus model',
    file: 'src/agent-runtime/claude-agent-sdk-runtime.ts',
    snippets: [
      "const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write']",
      'DEFAULT_CLAUDE_MODEL',
      'normalizeClaudeModelId',
      'createMyccClaudeHooks',
      'allowDangerouslySkipPermissions',
      "settingSources: this.resolveSettingSources()",
    ],
    forbiddenSnippets: [
      "|| 'claude-sonnet-4-6'",
      '/.mycc',
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
    label: 'Agent SDK product defaults use broad tools with hook guard and Opus model',
    file: 'src/agent-runtime/claude-agent-sdk-runtime.ts',
    snippets: [
      "const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write']",
      'DEFAULT_CLAUDE_MODEL',
      'normalizeClaudeModelId',
      'createMyccClaudeHooks',
      'allowDangerouslySkipPermissions',
      "settingSources: this.resolveSettingSources()",
    ],
    forbiddenSnippets: [
      "|| 'claude-sonnet-4-6'",
      '/.mycc',
    ],
  },
  {
    label: 'E2B code-server bridge defaults match assistant sandbox bridge',
    file: 'templates/e2b-code-server/agent-sdk-bridge.mjs',
    snippets: [
      "const DEFAULT_ALLOWED_TOOLS = 'Read,Glob,Grep,Bash,Edit,Write'",
      "const DEFAULT_MODEL = 'claude-opus-4-7'",
      'MODEL_ALIASES',
      'normalizeModelId',
      'createMyccBridgeHooks',
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
  const missing = check.snippets
    .map((snippet) => {
      if (typeof snippet === 'string') {
        return source.includes(snippet) ? null : snippet;
      }
      return snippet.anyOf.some((candidate) => source.includes(candidate)) ? null : snippet.label;
    })
    .filter((snippet): snippet is string => snippet !== null);
  const forbidden = (check.forbiddenSnippets ?? []).filter((snippet) => source.includes(snippet));
  if (missing.length > 0 || forbidden.length > 0) {
    failureCount += 1;
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      forbidden.length > 0 ? `contains forbidden ${forbidden.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    console.error(`[error] ${check.label}: ${check.file} ${details}`);
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
