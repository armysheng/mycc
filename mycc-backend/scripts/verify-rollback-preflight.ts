import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findForbiddenRollbackPatterns } from '../src/scripts/rollback-preflight-readiness.js';

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
const scriptPath = fileURLToPath(import.meta.url);

const checks: Check[] = [
  {
    label: 'package scripts expose rollback preflight gate',
    file: 'package.json',
    snippets: [
      '"verify:rollback-preflight"',
      'scripts/verify-rollback-preflight.ts',
    ],
  },
  {
    label: 'production runbook documents config-only backend rollback',
    file: 'docs/landing-production-runbook.md',
    snippets: [
      'Rollback requires explicit approval unless production is actively unavailable.',
      'Config-first fallback',
      'MYCC_AGENT_RUNTIME=remote-claude',
      'MYCC_IDE_PROVIDER=disabled',
      'MYCC_WORKSPACE_PROVIDER=ssh',
    ],
  },
  {
    label: 'production runbook documents restart cleanup and health checks',
    file: 'docs/landing-production-runbook.md',
    snippets: [
      'systemctl --user restart mycc-backend.service',
      'npm run cleanup:ide-sessions',
      'curl -fsS http://127.0.0.1:8080/health',
      'After rollback, re-run the no-side-effect gate.',
    ],
  },
  {
    label: 'production runbook forbids destructive database rollback',
    file: 'docs/landing-production-runbook.md',
    snippets: [
      'Do not drop `ide_sessions` or `agent_runs` during emergency rollback.',
      'Keeping',
      'preserves audit and cleanup state',
    ],
    forbiddenSnippets: [
      'DROP TABLE ide_sessions',
      'DROP TABLE agent_runs',
      'DROP TABLE IF EXISTS ide_sessions',
      'DROP TABLE IF EXISTS agent_runs',
    ],
  },
  {
    label: 'landing readiness keeps rollback rehearsal owner-gated',
    file: 'docs/landing-readiness.md',
    snippets: [
      '| Rollback rehearsal |',
      'Requires planned operations window and release owner notes.',
      'Fill the production runbook live gate decision packet before running any live smoke against the public target.',
      'Rollback has been rehearsed once.',
    ],
  },
  {
    label: 'E2B release readiness runs rollback preflight before release checks',
    file: 'docs/e2b-release-readiness.md',
    snippets: [
      'npm run verify:rollback-preflight',
      'npm run verify:e2b-release',
      'Rollback is config-first',
    ],
  },
];

function main() {
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
    const forbidden = [
      ...(check.forbiddenSnippets ?? []).filter((snippet) => source.includes(snippet)),
      ...findForbiddenRollbackPatterns(source),
    ];

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
    console.error(`Rollback rehearsal preflight: ${failureCount} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('Rollback rehearsal preflight: ready');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
